// ============================================================
// NodeFlow — Copiloto de configuración (#8, idea de Unai 2026-07-04)
// El dueño escribe con sus palabras ("corte quince euros media
// hora, tinte a presupuesto" / "abro de lunes a viernes de 9 a 8,
// sábados solo mañana") y el copiloto devuelve una PROPUESTA en el
// formato estructurado del portal. El flujo es de doble puerta:
// propuesta → el dueño la ve y pulsa Aplicar (rellena el
// formulario) → su Guardar de siempre persiste. El copiloto JAMÁS
// escribe en BD.
// El LLM solo redacta; los validadores deterministas de aquí son
// los que deciden qué entra (charter: nada de negocio depende de
// que el LLM se porte bien).
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('CONFIG-COPILOT');

let _openai = null;
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_openai) _openai = new (require('openai').OpenAI)({ apiKey });
  return _openai;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Propuesta de servicios del LLM → filas válidas de la tabla (o []). */
function validateServicesProposal(raw) {
  const list = raw && Array.isArray(raw.services) ? raw.services : [];
  return list
    .filter(s => s && typeof s === 'object' && String(s.name || '').trim())
    .slice(0, 60)
    .map(s => ({
      name:     String(s.name).trim().slice(0, 80),
      price:    s.price    ? String(s.price).trim().slice(0, 30)    : '',
      duration: s.duration ? String(s.duration).trim().slice(0, 30) : '',
      notes:    s.notes    ? String(s.notes).trim().slice(0, 160)   : '',
    }));
}

/** Propuesta de horario del LLM → {mon:{open,close,…}|null,…} solo con días/horas válidos. */
function validateScheduleProposal(raw) {
  const sched = raw && raw.schedule && typeof raw.schedule === 'object' && !Array.isArray(raw.schedule)
    ? raw.schedule : {};
  const out = {};
  for (const [day, slot] of Object.entries(sched)) {
    if (!DAY_KEYS.includes(day)) continue;
    if (slot === null) { out[day] = null; continue; } // cerrado
    if (!slot || typeof slot !== 'object') continue;
    if (!HHMM.test(slot.open || '') || !HHMM.test(slot.close || '')) continue;
    const d = { open: slot.open, close: slot.close };
    if (HHMM.test(slot.afternoon_open || '') && HHMM.test(slot.afternoon_close || '')) {
      d.afternoon_open = slot.afternoon_open;
      d.afternoon_close = slot.afternoon_close;
    }
    out[day] = d;
  }
  return out;
}

const PROMPTS = {
  services: `Convierte lo que dice el dueño de un negocio español en su lista de servicios. Devuelve SOLO JSON:
{"services":[{"name":"...","price":"...","duration":"...","notes":"..."}]}
Reglas:
- name obligatorio; price/duration/notes solo si el dueño los dijo (no inventes).
- price como lo diría en la tabla: "15€", "a presupuesto", "gratis", "desde 30€". "quince euros" → "15€".
- duration en minutos u horas: "media hora" → "30 min", "hora y media" → "90 min".
- Si no hay ningún servicio reconocible, devuelve {"services":[]}.`,
  schedule: `Convierte lo que dice el dueño de un negocio español en su horario semanal. Devuelve SOLO JSON:
{"schedule":{"mon":{"open":"09:00","close":"14:00","afternoon_open":"16:00","afternoon_close":"20:00"},"tue":...,"sun":null}}
Reglas:
- Claves: mon tue wed thu fri sat sun. Día cerrado = null. Día no mencionado: inclúyelo como null solo si el dueño dio a entender que no abre.
- Horas SIEMPRE "HH:MM" (24h). "de 9 a 2" = 09:00-14:00; "de 4 a 8" de tarde = 16:00-20:00.
- Jornada partida: open/close para la mañana + afternoon_open/afternoon_close para la tarde. Jornada continua: solo open/close.
- Si no se entiende ningún horario, devuelve {"schedule":{}}.`,
};

/**
 * Texto libre del dueño → propuesta estructurada validada.
 * @returns {Promise<{ok:true, services?:Array, schedule?:object}|{ok:false, error:string}>}
 */
async function parseConfigText(kind, text, deps = {}) {
  const clean = String(text || '').trim();
  if (!PROMPTS[kind]) return { ok: false, error: 'Tipo de ayuda desconocido.' };
  if (!clean) return { ok: false, error: 'Cuéntame primero qué quieres configurar.' };

  const openai = deps.openai !== undefined ? deps.openai : getOpenAI();
  if (!openai) return { ok: false, error: 'El copiloto no está disponible ahora mismo.' };

  let raw;
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PROMPTS[kind] },
        { role: 'user', content: clean.slice(0, 2000) },
      ],
      temperature: 0,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    });
    raw = JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    log.warn(`parseConfigText(${kind}) LLM falló: ${e.message}`);
    return { ok: false, error: 'No he podido procesarlo ahora mismo. Inténtalo de nuevo en un momento.' };
  }

  if (kind === 'services') {
    const services = validateServicesProposal(raw);
    if (!services.length) return { ok: false, error: 'No he entendido ningún servicio. Prueba así: «corte de pelo 15 euros media hora, tinte 45».' };
    return { ok: true, services };
  }
  const schedule = validateScheduleProposal(raw);
  if (!Object.keys(schedule).length) return { ok: false, error: 'No he entendido el horario. Prueba así: «de lunes a viernes de 9 a 2 y de 4 a 8, sábados solo mañana».' };
  return { ok: true, schedule };
}

module.exports = { parseConfigText, validateServicesProposal, validateScheduleProposal };
