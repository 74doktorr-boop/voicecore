// ============================================================
// NodeFlow — Auditor IA de calidad de conversación (v2 del
// Conversation Success Score determinista)
// Cada llamada real se audita sola tras colgar: ¿saludó bien?
// ¿entendió? ¿alucinó servicios/precios? ¿confirmó antes de
// reservar? ¿quedaría satisfecho un cliente real? El veredicto se
// persiste en nf_calls.metrics.audit → miles de auditorías
// automáticas = detectar regresiones antes que el cliente.
// Fire-and-forget, nunca bloquea ni tumba el post-call.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('CALL-AUDITOR');

let _openai = null;
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_openai) _openai = new (require('openai').OpenAI)({ apiKey });
  return _openai;
}

const AUDIT_PROMPT = `Eres un Auditor de Calidad de Conversaciones de un asistente telefónico de IA para negocios locales españoles. Analiza la transcripción y devuelve ÚNICAMENTE un JSON válido:
{
  "greeting_ok": true|false,
  "understood_customer": true|false,
  "unnecessary_questions": <número de preguntas innecesarias o repetidas>,
  "hallucinated": true|false,
  "confirmed_before_booking": true|false|null,
  "verbosity": "concisa"|"adecuada"|"se_enrolla",
  "customer_satisfied": true|false,
  "score": <0-100>,
  "info_gap": <string|null>,
  "problems": ["máx 3, cortos y concretos"],
  "improvements": ["máx 3, accionables"]
}

Criterios:
- hallucinated: afirmó servicios, precios, horarios o datos que NO aparecen respaldados en la conversación ni en el catálogo configurado, o se contradicen. TAMBIÉN cuenta prometer acciones que el sistema no puede hacer: «le envío la información por email/WhatsApp», «le llamo yo luego» — el asistente no puede enviar nada ni llamar por iniciativa propia (llamada real: prometió un email que jamás salió). EXCEPCIÓN: decir que «el equipo le llamará» después de registrar el interés del cliente es el guion diseñado — el dueño recibe ese aviso de verdad — y NO es alucinación.
- problems/improvements: decir que «el equipo te contactará / se pondrá en contacto» tras registrar el lead es el guion CORRECTO y honesto (el dueño recibe el aviso de verdad) — NO lo listes como problema ni como mejora. SOLO es un fallo si promete un PLAZO concreto («muy pronto», «hoy mismo», «en unos minutos») o una acción que el asistente no puede hacer (enviar email/WhatsApp, llamar por su propia iniciativa).
- info_gap: si el cliente pidió información (precio, servicio, horario) y el asistente NO se la dio, describe en pocas palabras qué dato faltó; si el catálogo configurado lo tenía, es un fallo grave (baja el score). null si no faltó nada.
- confirmed_before_booking: dijo en voz alta día y hora exactos Y esperó el sí del cliente antes de dar la cita por hecha (null si no hubo intento de reserva).
- unnecessary_questions: repetir una pregunta ya respondida cuenta.
- customer_satisfied: ¿un cliente REAL colgaría satisfecho?
- Sé exigente: puntúa como si el negocio fuera tuyo y cada llamada costara un cliente.

Devuelve SOLO el JSON.`;

function _clamp(audit) {
  if (!audit || typeof audit !== 'object') return null;
  const score = Number(audit.score);
  return {
    greeting_ok: audit.greeting_ok === true,
    understood_customer: audit.understood_customer === true,
    unnecessary_questions: Math.max(0, parseInt(audit.unnecessary_questions, 10) || 0),
    hallucinated: audit.hallucinated === true,
    confirmed_before_booking: audit.confirmed_before_booking === null || audit.confirmed_before_booking === undefined
      ? null : audit.confirmed_before_booking === true,
    verbosity: ['concisa', 'adecuada', 'se_enrolla'].includes(audit.verbosity) ? audit.verbosity : 'adecuada',
    customer_satisfied: audit.customer_satisfied === true,
    score: isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    // Hueco de conocimiento detectado: semilla del bucle de mejora (el dato
    // que el cliente pidió y el asistente no supo dar)
    info_gap: (typeof audit.info_gap === 'string' && audit.info_gap.trim()) ? audit.info_gap.trim().slice(0, 200) : null,
    problems: Array.isArray(audit.problems) ? audit.problems.slice(0, 3).map(String) : [],
    improvements: Array.isArray(audit.improvements) ? audit.improvements.slice(0, 3).map(String) : [],
  };
}

/**
 * Audita una llamada terminada. Devuelve el veredicto o null.
 * @param {object} callData - session.toJSON() (transcript, outcome...)
 * @param {object} [deps]   - { openai } inyectable en tests
 */
async function auditCall(callData, deps = {}) {
  const transcript = callData?.transcript;
  if (!Array.isArray(transcript) || transcript.length < 2) return null;
  const openai = deps.openai || getOpenAI();
  if (!openai) { log.warn('OPENAI_API_KEY no configurada — auditoría omitida'); return null; }

  const text = transcript
    .map(t => `${t.role === 'assistant' ? 'Asistente' : 'Cliente'}: ${t.content}`)
    .join('\n');

  // Contexto del negocio: el auditor debe jugar con las mismas cartas que el
  // asistente. Sin esto (caso real 2026-07-04) marcó como alucinación el
  // guion correcto de modo contacto y no pudo ver que el precio configurado
  // (49€) jamás se dijo en una llamada de información.
  const ctxParts = [];
  if (callData.assistantMode === 'contacto') {
    ctxParts.push('Modo del asistente: modo contacto (negocio SIN agenda: informa, registra interesados y el equipo humano devuelve la llamada — ese guion es el correcto).');
  } else if (callData.assistantMode === 'citas') {
    ctxParts.push('Modo del asistente: modo citas (agenda real con herramientas de disponibilidad y reserva).');
  }
  if (Array.isArray(callData.serviceList) && callData.serviceList.length) {
    ctxParts.push('CATÁLOGO configurado (única verdad de servicios/precios que el asistente DEBÍA usar):\n' +
      callData.serviceList.filter(s => s && s.name).map(s => {
        let l = `- ${s.name}`;
        if (s.price) l += `: ${s.price}`;
        if (s.duration) l += ` (${s.duration})`;
        return l;
      }).join('\n'));
  }
  // Sector-aware (2026-07-04): el auditor juzga con la RÚBRICA del sector.
  // "Bien hecho" en una clínica dental no es lo mismo que en un restaurante.
  const { resolveSector } = require('../sectors/sector-registry');
  const sector = resolveSector(callData.sector);
  if (sector.slug !== 'generico' && sector.metricChecks.length) {
    ctxParts.push(`SECTOR: ${sector.label}. Además de lo general, evalúa específicamente estos puntos propios de este sector; si el asistente falla alguno, refléjalo en "problems" o "improvements":\n` +
      sector.metricChecks.map(m => `- ${m.label}`).join('\n'));
  }
  const ctx = ctxParts.length ? ctxParts.join('\n') + '\n\n' : '';

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: AUDIT_PROMPT },
        { role: 'user', content: `${ctx}Resultado registrado: ${callData.outcome || 'desconocido'}\n\nTranscripción:\n${text}` },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const audit = _clamp(JSON.parse(resp.choices[0].message.content));
    // Estampar el sector: es la clave que el agregador usa para agrupar por
    // vertical y sacar reglas candidatas POR SECTOR (no globales).
    if (audit) { audit.sector = sector.slug; log.info(`[${callData.id}] Auditoría [${sector.slug}]: score ${audit.score}, satisfecho ${audit.customer_satisfied}, alucinación ${audit.hallucinated}`); }
    return audit;
  } catch (e) {
    log.warn(`[${callData.id}] Auditoría falló: ${e.message}`);
    return null;
  }
}

module.exports = { auditCall, _clamp };
