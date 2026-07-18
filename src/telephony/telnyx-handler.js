// ============================================
// VoiceCore — Telnyx Media Streams Handler
// WebSocket handler for Telnyx bidirectional audio
// Telnyx uses TeXML (identical to TwiML) + Media Streams
// ============================================

const { Logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const log = new Logger('TELNYX');

/**
 * Set up WebSocket handler for Telnyx Media Streams
 * Telnyx media stream format is identical to Twilio's — same events:
 * connected → start → media → mark → stop
 */
function setupTelnyxStreams(wss, pipeline, assistantManager) {

  wss.on('connection', (ws, req) => {
    // Only handle Telnyx connections (path: /telnyx-stream)
    if (req.url && !req.url.includes('telnyx')) return;

    const callId = uuidv4();
    let streamSid = null;
    let callSid = null;
    let sessionStarted = false;
    // wsEnded (auditoría 2026-07-16): el cliente puede COLGAR durante los ~2s
    // que tarda startCall (BD+RAG+síntesis del saludo). En esa ventana
    // sessionStarted aún es false, así que stop/close no llaman a endCall; luego
    // startCall resuelve y registra la sesión en activeCalls → FUGA permanente
    // (a ~10 fantasmas el asistente alcanza el cap y RECHAZA llamadas reales).
    // Este flag lo marcan stop/close SIEMPRE; tras startCall se comprueba.
    let wsEnded = false;

    log.call(`[${callId}] New Telnyx WebSocket connection`);

    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);

        switch (msg.event) {
          case 'connected':
            log.call(`[${callId}] Telnyx connected — protocol: ${msg.protocol}`);
            break;

          case 'start':
            streamSid = msg.start?.streamSid || msg.streamSid || uuidv4();
            callSid   = msg.start?.callSid   || msg.callSid   || 'unknown';

            const callerNumber = msg.start?.customParameters?.from
              || msg.start?.from
              || req.headers?.['x-telnyx-from']
              || 'unknown';

            const calledNumber = msg.start?.customParameters?.to
              || msg.start?.to
              || req.headers?.['x-telnyx-to']
              || 'unknown';

            const assistantId = msg.start?.customParameters?.assistantId
              || new URL('https://x' + (req.url || '')).searchParams.get('assistantId')
              || null;

            // ── Códec REAL del stream entrante (causa raíz 2026-07-03) ──────
            // Telnyx entrega el audio en el códec de la llamada: en Europa es
            // PCMA (A-law). Durante semanas se decodificó TODO como PCMU
            // (mu-law): voz "casi" inteligible que destrozaba el STT
            // ("corte de pelo" → "cortador de vuelo", confidence 0.78 vs
            // 0.995 con el códec correcto — demostrado con audio capturado).
            const rawFormat = msg.start?.media_format || msg.start?.mediaFormat || null;
            const rawEncoding = rawFormat?.encoding || '';
            const mediaEncoding = /alaw|PCMA/i.test(rawEncoding) ? 'alaw'
              : /mulaw|PCMU/i.test(rawEncoding) ? 'mulaw'
              : null;
            if (!mediaEncoding) {
              log.warn(`[${callId}] Stream SIN media_format reconocible (${JSON.stringify(rawFormat)}) — asumiendo alaw (PCMA, estándar europeo)`);
            }

            log.call(`[${callId}] Stream started`, { streamSid, callSid, callerNumber, calledNumber, assistantId, mediaFormat: rawEncoding || '—', sttEncoding: mediaEncoding || 'alaw' });

            // Contexto de SALIENTE (test/recuperación/campaña): la llamada la
            // iniciamos NOSOTROS, así que el asistente correcto es el de ESA org.
            // NO se puede resolver por el número llamado (es el del CLIENTE, no el
            // de la org) → antes caía al asistente demo por defecto ("bufete de
            // abogados"). Se consume aquí, UNA vez, y su businessId manda.
            let outCtx = null;
            try {
              const { consumeOutboundContext } = require('./outbound');
              outCtx = await consumeOutboundContext(callerNumber, calledNumber);
            } catch (e) { log.warn(`[${callId}] outbound context: ${e.message}`); }

            // Resolve assistant: SALIENTE (org del contexto) → archivo → org por
            // param → por número (pool) → por número → default.
            let assistant;
            let source = 'default';
            if (outCtx && outCtx.businessId) {
              try {
                assistant = await require('../assistants/org-assistant').getOrgAssistant(outCtx.businessId);
                if (assistant) source = 'saliente:' + outCtx.businessId;
              } catch (e) { log.warn(`[${callId}] outbound org-assistant fallo: ${e.message}`); }
            }
            if (!assistant && assistantId) {
              assistant = assistantManager.get(assistantId);
              if (assistant) source = 'archivo:' + assistantId;
              if (!assistant) {
                // assistantId puede ser un orgId (lo resuelve el webhook por número):
                // construimos el asistente real del negocio desde su config del portal.
                try {
                  assistant = await require('../assistants/org-assistant').getOrgAssistant(assistantId);
                  if (assistant) source = 'org:' + assistantId;
                } catch (e) {
                  log.warn(`[${callId}] org-assistant fallo: ${e.message}`);
                }
              }
            }
            if (!assistant && calledNumber && calledNumber !== 'unknown') {
              // Blindaje: si el Parameter del TeXML no llegó por el stream,
              // resolvemos la org directamente por el número llamado (pool).
              try {
                const orgId = await pipeline._resolveOrgId(calledNumber);
                if (orgId) {
                  assistant = await require('../assistants/org-assistant').getOrgAssistant(orgId);
                  if (assistant) source = 'pool:' + orgId;
                }
              } catch (e) {
                log.warn(`[${callId}] resolución por número fallo: ${e.message}`);
              }
            }
            if (!assistant) {
              assistant = assistantManager.getByPhoneNumber(calledNumber);
              if (assistant) source = 'byNumber';
            }
            if (!assistant) {
              assistant = assistantManager.getDefault();
              source = 'default';
            }
            log.call(`[${callId}] Asistente: ${assistant?.name || '?'} (${assistant?.id || '?'}) vía ${source} | param=${assistantId || '—'} to=${calledNumber}`);
            if (!assistant) {
              log.warn(`[${callId}] No assistant found, using built-in fallback`);
              assistant = {
                id: 'default-fallback',
                name: 'NodeFlow Asistente',
                systemPrompt: 'Eres un asistente telefónico amable de NodeFlow. Responde en español de forma concisa y natural. Ayuda al cliente con lo que necesite.',
                firstMessage: 'Hola, gracias por llamar a NodeFlow. ¿En qué puedo ayudarte?',
                voice: 'nova',
                language: 'es',
                model: 'gpt-4o-mini',
              };
            }

            // ── Saliente con propósito: outCtx ya se consumió arriba (donde
            // resolvió la org). Se clona el asistente (los de org están cacheados
            // — no mutar) añadiendo el bloque de propósito al prompt.
            let direction = 'inbound';
            let campaignRef = null;
            if (outCtx) {
              direction = 'outbound';
              campaignRef = outCtx.ref || null;
              if (outCtx.promptBlock) {
                assistant = { ...assistant, systemPrompt: (assistant.systemPrompt || '') + outCtx.promptBlock };
              }
              log.call(`[${callId}] Saliente con propósito: ${outCtx.purpose}${outCtx.ref ? ' (ref ' + outCtx.ref + ')' : ''}`);
            }

            // Start pipeline session (same interface as Twilio)
            const started = await pipeline.startCall({
              callId,
              assistant,
              callerNumber,
              calledNumber,
              direction,
              twilioWs: ws,      // pipeline accepts both twilio/telnyx — same WS protocol
              streamSid,
              provider: 'telnyx',
              mediaEncoding,     // códec real anunciado por Telnyx (alaw/mulaw)
              // La demo pública Llámame se autocorta antes (6 min por defecto):
              // una demo no necesita más y acota el gasto del endpoint público.
              maxMinutes: (outCtx && outCtx.purpose === 'llamame_demo')
                ? (Number(process.env.LLAMAME_MAX_MINUTES) || 6) : null,
            });

            // Rechazada por el cap de concurrentes → cerrar el stream.
            if (!started) {
              log.warn(`[${callId}] Llamada rechazada (cap de concurrentes) — cerrando stream`);
              ws.close();
              return;
            }

            sessionStarted = true;
            // ¿El cliente colgó MIENTRAS arrancábamos? La sesión acaba de
            // registrarse en activeCalls y nadie la limpiaría → ciérrala ya.
            if (wsEnded) {
              log.warn(`[${callId}] Cuelgue durante el arranque — cerrando la sesión recién creada`);
              pipeline.endCall(callId);
              sessionStarted = false;
              try { ws.close(); } catch (_) {}
              return;
            }
            // Enlace Campaign Core: el post-call cerrará el job con el outcome real.
            if (campaignRef) {
              const s = pipeline.activeCalls?.get?.(callId);
              if (s) s.campaignRef = campaignRef;
            }
            break;

          case 'media':
            if (sessionStarted) {
              pipeline.handleAudio(callId, msg.media.payload);
            }
            break;

          case 'mark':
            if (sessionStarted && msg.mark?.name) {
              pipeline.handleMark(callId, msg.mark.name);
            }
            break;

          case 'stop':
            log.call(`[${callId}] Stream stopped`);
            wsEnded = true;   // marca la ventana de arranque (ver flag arriba)
            // Telnyx anuncia el fin del stream: cerrar la sesión YA. Esperar
            // solo al close del WS dejaba llamadas 'active' colgadas si el
            // socket no moría (caso real 2026-07-03, fila 6e70d935).
            if (sessionStarted) {
              pipeline.endCall(callId);
              sessionStarted = false;
            }
            try { ws.close(); } catch (_) {}
            break;

          default:
            break;
        }
      } catch (error) {
        log.error(`[${callId}] Error processing message`, { error: error.message });
      }
    });

    ws.on('close', () => {
      log.call(`[${callId}] WebSocket closed`);
      wsEnded = true;   // si el close cae DURANTE el arranque, el chequeo
                        // tras startCall limpiará la sesión recién creada.
      if (sessionStarted) {
        pipeline.endCall(callId);
      }
    });

    ws.on('error', (error) => {
      log.error(`[${callId}] WebSocket error`, { error: error.message });
    });
  });

  log.info('Telnyx Media Streams handler ready');
}

/**
 * Generate TeXML for incoming Telnyx calls.
 * TeXML is Telnyx's version of TwiML — nearly identical syntax.
 * Docs: https://developers.telnyx.com/docs/voice/texml/texml-overview
 */
// Escapado de atributos XML (auditoría 2026-07-08): assistantId puede llegar
// de la query del webhook y wsUrl deriva del header Host — sin escapar, un
// valor con comillas/ángulos rompe (o inyecta) el TeXML devuelto.
function escapeXmlAttr(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

function generateTeXML(wsUrl, assistantId = null) {
  const params = assistantId
    ? `\n      <Parameter name="assistantId" value="${escapeXmlAttr(assistantId)}" />`
    : '';
  wsUrl = escapeXmlAttr(wsUrl);
  // bidirectionalMode="rtp" es OBLIGATORIO en Telnyx: sin él el stream es solo
  // de entrada y el audio del asistente se descarta (llamada en silencio).
  // PCMU = mulaw 8kHz, el mismo formato que ya enviamos por el WS (Twilio-compat).
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" bidirectionalMode="rtp" bidirectionalCodec="PCMU">${params}
    </Stream>
  </Connect>
</Response>`;
}

module.exports = { setupTelnyxStreams, generateTeXML };
