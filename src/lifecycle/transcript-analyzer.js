// ============================================================
// NodeFlow — Transcript Analyzer (Lifecycle System)
// Async post-call analysis: GPT summary → contact_memory update.
// Always fire-and-forget. Retries up to 3 times. Never silent fail.
// ============================================================

const { getDatabase }        = require('../db/database');
const { upsertContactMemory } = require('./call-memory');
const { Logger }              = require('../utils/logger');

const log = new Logger('TRANSCRIPT-ANALYZER');
const MAX_RETRIES = 3;

let _openai = null;
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_openai) _openai = new (require('openai').OpenAI)({ apiKey });
  return _openai;
}

const SYSTEM_PROMPT = `Eres un asistente que analiza transcripciones de llamadas telefónicas de negocios españoles.
Analiza la transcripción y devuelve ÚNICAMENTE un objeto JSON válido con estos campos:
{
  "summary": "Resumen de 2-3 frases de lo ocurrido",
  "outcome": "<ver valores válidos>",
  "preferences": { "horario": "mañana|tarde|null", "idioma": "es|eu|gl|null", "tono": "formal|informal|null" },
  "sensitivities": {},
  "extracted_data": {},
  "topics": [],
  "unanswered_questions": []
}

Valores válidos para outcome: booked | rescheduled | declined | no_answer | callback_requested | wrong_number | do_not_contact | voicemail_left
- callback_requested TAMBIÉN cuando el asistente registró el interés del cliente y prometió que el equipo le devolverá la llamada.

En extracted_data incluye cualquier dato relevante mencionado:
- nombre_llamante: el nombre que el LLAMANTE dio para SÍ MISMO («me llamo X», «soy X»). null si no lo dio o si el nombre era de OTRA persona («cita para mi novia Nerea» → null).
- interes: qué servicio o información buscaba, en pocas palabras (null si no aplica)
- fecha_itv, fecha_ultimo_aceite, matricula, marca_modelo (taller)
- nombre_mascota, fecha_proxima_vacuna, especie_raza (veterinaria)
- fecha_cumpleanos, fecha_aniversario (cualquier sector)
- frecuencia_sesiones en días (psicología, nutrición)

En topics incluye tags como: vacuna, itv, cambio_aceite, presupuesto, horario, cancelación, etc.

En unanswered_questions incluye SOLO las preguntas que el asistente NO supo responder o respondió con evasivas explícitas ("no tengo esa información", "tendría que consultarlo").
REGLAS ESTRICTAS:
- Una respuesta NEGATIVA es una respuesta: "¿cortáis barba?" → "no, solo corte de pelo" está RESPONDIDA. No la incluyas.
- NO incluyas preguntas sobre horarios, servicios, precios, disponibilidad o citas si el asistente dio una respuesta concreta (aunque fuera "no hay huecos").
- Solo cuenta como no respondida si el asistente lo dijo explícitamente o cambió de tema sin responder.
Escribe cada una como pregunta corta y clara, tal y como la haría el cliente. Si no hubo ninguna, lista vacía. Máximo 5.

Devuelve SOLO el JSON. Sin texto adicional.`;

/**
 * Analyze a call transcript via GPT-4o-mini.
 * Returns parsed analysis object, or null after MAX_RETRIES failures.
 * @param {Array|string} transcript
 * @param {number} attempt
 */
async function analyzeTranscript(transcript, attempt = 1) {
  const openai = getOpenAI();
  if (!openai) {
    log.warn('OPENAI_API_KEY not set — skipping transcript analysis');
    return null;
  }

  const text = Array.isArray(transcript)
    ? transcript.map(t => `${t.role === 'assistant' ? 'Asistente' : 'Cliente'}: ${t.content}`).join('\n')
    : String(transcript || '');

  if (!text.trim()) {
    log.warn('analyzeTranscript: empty transcript — skipping');
    return null;
  }

  try {
    const resp = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      messages:    [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Transcripción:\n${text}` },
      ],
      temperature:  0,
      max_tokens:   800,
      response_format: { type: 'json_object' },
    });

    const raw = JSON.parse(resp.choices[0].message.content);
    // Normalize to prevent case/type mismatches in downstream checks
    raw.outcome        = typeof raw.outcome === 'string' ? raw.outcome.toLowerCase().trim() : null;
    raw.topics         = Array.isArray(raw.topics) ? raw.topics : [];
    raw.preferences    = raw.preferences    && typeof raw.preferences    === 'object' ? raw.preferences    : {};
    raw.sensitivities  = raw.sensitivities  && typeof raw.sensitivities  === 'object' ? raw.sensitivities  : {};
    raw.extracted_data = raw.extracted_data && typeof raw.extracted_data === 'object' ? raw.extracted_data : {};
    // Filtro determinista además del prompt: horarios/servicios/precios/
    // disponibilidad/citas salen de la CONFIGURACIÓN y de los tools — si el
    // asistente falla ahí es un bug del sistema, no un hueco de conocimiento
    // que el dueño deba rellenar a mano. Caso real 2026-07-03: la KB pedía
    // al dueño "responder" ¿qué servicios tenéis? y ¿qué horarios tenéis?,
    // preguntas que el asistente había respondido con datos de config.
    const STRUCTURED = /horario|servicio|precio|cu[aá]nto (cuesta|vale)|disponib|cita|reserva|hueco|abr[ií]s|cerr[aá]is|ten[eé]is (libre|sitio)/i;
    raw.unanswered_questions = Array.isArray(raw.unanswered_questions)
      ? raw.unanswered_questions
          .filter(q => typeof q === 'string' && q.trim().length > 5)
          .filter(q => !STRUCTURED.test(q))
          .map(q => q.trim().slice(0, 160))
          .slice(0, 5)
      : [];
    return raw;
  } catch (err) {
    const is4xx = err.status && err.status >= 400 && err.status < 500;
    if (attempt < MAX_RETRIES && !is4xx) {
      log.warn(`analyzeTranscript attempt ${attempt} failed: ${err.message} — retrying in ${attempt}s`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
      return analyzeTranscript(transcript, attempt + 1);
    }
    // All retries exhausted — log with full context, never silent
    log.error(`analyzeTranscript failed after ${MAX_RETRIES} attempts: ${err.message}`);
    return null;
  }
}

/**
 * Full async post-call processing pipeline:
 * 1. Analyze transcript
 * 2. Insert call_summaries (immutable)
 * 3. Upsert contact_memory (merged)
 * 4. Update sector_data with any extracted dates/fields
 *
 * Call fire-and-forget: processCallAsync({...}).catch(() => {})
 */
async function processCallAsync({ callSessionId, contactId, orgId, transcript, callerNumber, leadRegistered }) {
  try {
    if (!contactId || !orgId) {
      log.warn('processCallAsync: missing contactId or orgId — skipping');
      return;
    }

    const analysis = await analyzeTranscript(transcript);
    if (!analysis) {
      // Already logged with context in analyzeTranscript
      log.warn(`processCallAsync: analysis null for session ${callSessionId} contact ${contactId}`);
      return;
    }

    const db = getDatabase();
    if (!db.enabled) return;

    // Red de seguridad (2026-07-04): ficha el nombre que dio el llamante y
    // recupera el lead si el asistente lo prometió pero no llamó al tool.
    try {
      const { applyLeadSafetyNet } = require('./lead-safety-net');
      await applyLeadSafetyNet({ analysis, contactId, orgId, callerNumber, leadRegistered, callSessionId, transcript });
    } catch (e) { log.warn(`lead safety net: ${e.message}`); }

    // 1. Insert immutable call summary
    // _unanswered viaja dentro de extracted_data (jsonb) — cero migraciones;
    // lo agrega /api/portal/knowledge/unanswered para el bucle de conocimiento.
    const extractedWithUnanswered = {
      ...(analysis.extracted_data || {}),
      ...(analysis.unanswered_questions && analysis.unanswered_questions.length
        ? { _unanswered: analysis.unanswered_questions }
        : {}),
    };
    const { error: summaryErr } = await db.client.from('call_summaries').insert({
      call_session_id: callSessionId || null,
      org_id:          orgId,
      contact_id:      contactId,
      summary:         analysis.summary    || '',
      outcome:         analysis.outcome    || null,
      extracted_data:  extractedWithUnanswered,
      topics:          analysis.topics     || [],
    });
    if (summaryErr) log.error('call_summaries insert failed', { err: summaryErr.message });

    // 2. Upsert contact memory
    const memUpdates = {
      incrementCallCount: true,
      last_call_at:       new Date().toISOString(),
      last_call_summary:  analysis.summary || '',
      preferences:        analysis.preferences  || {},
      sensitivities:      analysis.sensitivities || {},
    };
    if (analysis.outcome === 'do_not_contact') {
      memUpdates.no_whatsapp = true;
      memUpdates.no_email    = true;
      memUpdates.no_sms      = true;
    }
    await upsertContactMemory(contactId, orgId, memUpdates);

    // 3. If extracted_data has known-safe fields, merge into contacts.sector_data
    const SECTOR_DATA_ALLOWLIST = new Set([
      'fecha_itv', 'fecha_vencimiento_itv', 'fecha_ultimo_aceite', 'matricula', 'marca_modelo',
      'nombre_mascota', 'fecha_proxima_vacuna', 'especie_raza', 'fecha_nacimiento_mascota',
      'fecha_cumpleanos', 'fecha_aniversario', 'frecuencia_sesiones',
      'fecha_alta', 'fecha_fin_curso', 'suministro_lentillas_dias', 'tipo_servicio_habitual',
    ]);
    const safeExtracted = Object.fromEntries(
      Object.entries(analysis.extracted_data).filter(([k]) => SECTOR_DATA_ALLOWLIST.has(k))
    );
    if (Object.keys(safeExtracted).length > 0) {
      const { data: contact, error: contactErr } = await db.client
        .from('contacts').select('sector_data').eq('id', contactId).maybeSingle();
      if (contactErr) {
        log.warn('sector_data fetch failed', { err: contactErr.message });
      } else {
        const merged = { ...(contact?.sector_data || {}), ...safeExtracted };
        await db.client.from('contacts')
          .update({ sector_data: merged })
          .eq('id', contactId)
          .then(undefined, e => log.warn('sector_data auto-update failed', { err: e.message }));
      }
    }

    log.info(`processCallAsync done: contact ${contactId}, outcome: ${analysis.outcome}, topics: ${(analysis.topics || []).join(',')}`);
  } catch (err) {
    log.error(`processCallAsync threw unexpectedly: ${err.message}`, { callSessionId, contactId });
  }
}

module.exports = { analyzeTranscript, processCallAsync };
