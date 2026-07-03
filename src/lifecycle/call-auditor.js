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
  "problems": ["máx 3, cortos y concretos"],
  "improvements": ["máx 3, accionables"]
}

Criterios:
- hallucinated: afirmó servicios, precios, horarios o datos que NO aparecen respaldados en la conversación o se contradicen. TAMBIÉN cuenta prometer acciones que el sistema no puede hacer: «le envío la información por email/WhatsApp», «le devuelvo la llamada yo» — el asistente no puede enviar nada ni llamar por iniciativa propia (llamada real: prometió un email que jamás salió).
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

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: AUDIT_PROMPT },
        { role: 'user', content: `Resultado registrado: ${callData.outcome || 'desconocido'}\n\nTranscripción:\n${text}` },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const audit = _clamp(JSON.parse(resp.choices[0].message.content));
    if (audit) log.info(`[${callData.id}] Auditoría: score ${audit.score}, satisfecho ${audit.customer_satisfied}, alucinación ${audit.hallucinated}`);
    return audit;
  } catch (e) {
    log.warn(`[${callData.id}] Auditoría falló: ${e.message}`);
    return null;
  }
}

module.exports = { auditCall, _clamp };
