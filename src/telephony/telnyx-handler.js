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

            log.call(`[${callId}] Stream started`, { streamSid, callSid, callerNumber, calledNumber, assistantId });

            // Resolve assistant: archivo → org (assistant_config del portal) → por número → default
            let assistant;
            if (assistantId) {
              assistant = assistantManager.get(assistantId);
              if (!assistant) {
                // assistantId puede ser un orgId (lo resuelve el webhook por número):
                // construimos el asistente real del negocio desde su config del portal.
                try {
                  assistant = await require('../assistants/org-assistant').getOrgAssistant(assistantId);
                } catch (e) {
                  log.warn(`[${callId}] org-assistant fallo: ${e.message}`);
                }
              }
            }
            if (!assistant) {
              assistant = assistantManager.getByPhoneNumber(calledNumber)
                || assistantManager.getDefault();
            }
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

            // Start pipeline session (same interface as Twilio)
            const started = await pipeline.startCall({
              callId,
              assistant,
              callerNumber,
              calledNumber,
              direction: 'inbound',
              twilioWs: ws,      // pipeline accepts both twilio/telnyx — same WS protocol
              streamSid,
              provider: 'telnyx',
            });

            // Rechazada por el cap de concurrentes → cerrar el stream.
            if (!started) {
              log.warn(`[${callId}] Llamada rechazada (cap de concurrentes) — cerrando stream`);
              ws.close();
              return;
            }

            sessionStarted = true;
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
function generateTeXML(wsUrl, assistantId = null) {
  const params = assistantId
    ? `\n      <Parameter name="assistantId" value="${assistantId}" />`
    : '';
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
