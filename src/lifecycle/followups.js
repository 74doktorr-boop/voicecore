// ============================================================
// NodeFlow — Seguimientos personalizados (2026-07-06)
// ------------------------------------------------------------
// Decisión Unai: NADA de recalls masivos automáticos (a destiempo,
// gente que ya no va → quejas). En su lugar, seguimiento PERSONAL,
// cliente a cliente, HUMANO en el bucle, por el WhatsApp del propio
// negocio.
//
// El sistema SUGIERE candidatos (quien llamó y no reservó) y redacta
// un mensaje personalizado con su contexto; el dueño lo revisa, edita
// y envía. Dos vías operativas (en el portal): enlace wa.me (envía él
// desde su WhatsApp, sin límite de plantilla) y API de su número.
//
// getCandidates() + draftMessage() (pura). markDone() marca hecho para
// que no reaparezca. Fail-open sin BD.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const { phoneVariants, normalizePhone } = require('../utils/phone');
const log = new Logger('FOLLOWUPS');

function _firstName(name) {
  const n = String(name || '').trim().split(/\s+/)[0];
  return n && n.length > 1 ? n : '';
}

/**
 * Redacta un mensaje de seguimiento PERSONALIZADO (editable por el dueño).
 * PURA. reason viene del outcome de la llamada; lang del idioma del negocio
 * (es/gl/eu; los bilingües es+gl / es+eu usan la lengua propia — el dueño
 * siempre puede editarlo antes de enviar).
 */
function draftMessage({ name, reason, bizName, lang, assistantName } = {}) {
  const fn = _firstName(name);
  const base = String(lang || 'es').includes('gl') ? 'gl' : String(lang || 'es').includes('eu') ? 'eu' : 'es';
  // El asistente se presenta por SU nombre y el del negocio: «Soy Laura de
  // Fisioterapia Unai» — no «Soy Fisioterapia Unai» (un negocio no se llama a sí
  // mismo por su nombre al escribir). Si no hay nombre de asistente, se cae al
  // formato anterior (solo negocio) para no romper nada.
  const asst = String(assistantName || '').trim();
  const soy = {
    es: asst && bizName ? ` Soy ${asst} de ${bizName}.` : (bizName ? ` Soy ${bizName}.` : ''),
    gl: asst && bizName ? ` Son ${asst} de ${bizName}.` : (bizName ? ` Son ${bizName}.` : ''),
    eu: asst && bizName ? ` ${asst} naiz, ${bizName}-ekoa.` : (bizName ? ` ${bizName} naiz.` : ''),
  }[base];
  const hola = {
    es: fn ? `Hola ${fn}` : 'Hola',
    gl: fn ? `Ola ${fn}` : 'Ola',
    eu: fn ? `Kaixo ${fn}` : 'Kaixo',
  }[base];

  const T = {
    es: {
      callback_requested: `${hola}, ¿qué tal?${soy} Nos dejaste tus datos para que te llamáramos. ¿Te viene bien que agendemos? Dime qué día te encaja y lo miramos. 🙂`,
      abandoned:          `${hola}, ¿qué tal?${soy} Se nos cortó la llamada del otro día. Si quieres seguimos por aquí, dime en qué te puedo ayudar. 🙂`,
      info:               `${hola}, ¿qué tal?${soy} Vi que nos consultaste hace poco. Si te encaja, te busco un hueco cuando quieras — ¿te ayudo? 🙂`,
    },
    gl: {
      callback_requested: `${hola}, que tal?${soy} Deixáchesnos os teus datos para que te chamaramos. Vénche ben que o axendemos? Dime que día che encaixa e mirámolo. 🙂`,
      abandoned:          `${hola}, que tal?${soy} Cortóusenos a chamada do outro día. Se queres seguimos por aquí, dime en que che podo axudar. 🙂`,
      info:               `${hola}, que tal?${soy} Vin que nos consultaches hai pouco. Se che encaixa, búscoche un oco cando queiras — axúdoche? 🙂`,
    },
    eu: {
      callback_requested: `${hola}, zer moduz?${soy} Zure datuak utzi zenizkigun deitzeko. Ondo al datorkizu hitzordua jartzea? Esadazu zein egun datorkizun ondo eta begiratuko dugu. 🙂`,
      abandoned:          `${hola}, zer moduz?${soy} Lehengo egunean deia moztu zitzaigun. Nahi baduzu hemendik jarraituko dugu — esadazu zertan lagun zaitzakedan. 🙂`,
      info:               `${hola}, zer moduz?${soy} Duela gutxi kontsulta egin zenigula ikusi dut. Nahi duzunean tarte bat bilatuko dizut — lagunduko dizut? 🙂`,
    },
  }[base];

  return T[reason] || T.info;
}

/**
 * Recorta a `max` unidades UTF-16 SIN partir pares suplentes: un corte a lo
 * bruto por en medio de un emoji (🙂 son 2 unidades) deja un suplente huérfano
 * que el navegador/WhatsApp pinta como "�". PURA.
 */
function truncateSafe(str, max) {
  const s = String(str || '');
  if (s.length <= max) return s;
  let cut = max;
  const hi = s.charCodeAt(cut - 1);
  if (hi >= 0xD800 && hi <= 0xDBFF) cut--;   // el corte caía en mitad de un emoji
  return s.slice(0, cut);
}

/** Motivo canónico de la sugerencia (los outcomes raros/null caen a 'info'). */
function followupKind(outcome) {
  return outcome === 'callback_requested' || outcome === 'abandoned' ? outcome : 'info';
}

/**
 * UNA sugerencia activa por (teléfono normalizado + motivo). PURA.
 * - Si el mismo contacto llama 3 veces y no reserva, gana la llamada MÁS
 *   RECIENTE (no 3 tarjetas idénticas — bug 2026-07-08, los "tres Raúles").
 * - Si CUALQUIER llamada del grupo ya se siguió (metrics.followup.done), se
 *   silencian también las hermanas anteriores: seguir al CONTACTO una vez
 *   basta. Una llamada POSTERIOR al seguimiento sí vuelve a sugerirse.
 * @param {Array} calls filas de nf_calls (caller_number, outcome, started_at, metrics)
 * @returns {Array} una fila por grupo, las más recientes primero.
 */
function dedupeCalls(calls) {
  const groups = new Map();
  for (const c of calls || []) {
    if (!c || !c.caller_number) continue;
    const key = (normalizePhone(c.caller_number) || c.caller_number) + '|' + followupKind(c.outcome);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const ts = (c) => new Date((c && c.started_at) || 0).getTime() || 0;
  const out = [];
  for (const list of groups.values()) {
    let doneUntil = 0;   // último seguimiento hecho al contacto (por este motivo)
    for (const c of list) {
      const f = c.metrics && c.metrics.followup;
      if (f && f.done) doneUntil = Math.max(doneUntil, new Date(f.at || c.started_at || 0).getTime() || 0);
    }
    const pending = list.filter(c => {
      const f = c.metrics && c.metrics.followup;
      if (f && f.done) return false;
      return !doneUntil || ts(c) > doneUntil;   // cubierta por un seguimiento previo
    });
    if (!pending.length) continue;
    pending.sort((a, b) => ts(b) - ts(a));
    out.push(pending[0]);
  }
  out.sort((a, b) => ts(b) - ts(a));
  return out;
}

/**
 * Candidatos a seguimiento: llamadas recientes que NO acabaron en cita y que
 * aún no se han seguido. UNA tarjeta por contacto y motivo (dedupeCalls).
 * Resuelve el nombre del contacto y redacta el mensaje.
 * @returns {Promise<Array>} [{ callId, phone, name, reason, when, score, draft }]
 */
async function getCandidates(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return [];
  const limit = opts.limit || 40;
  const bizName = opts.bizName || null;
  const assistantName = opts.assistantName || null;
  const lang = opts.lang || 'es';
  const since = new Date(Date.now() - 21 * 864e5).toISOString();

  let calls = [];
  try {
    // OJO SQL: .neq('outcome','booked') excluiría también los NULL (llamadas aún
    // sin clasificar) — el .or los mantiene como candidatos.
    const { data } = await db.client.from('nf_calls')
      .select('id, caller_number, outcome, started_at, metrics')
      .eq('org_id', orgId)
      .gte('started_at', since)
      .or('outcome.is.null,outcome.neq.booked')
      .order('started_at', { ascending: false })
      .limit(limit);
    // La bandera de "ya seguido" es NUESTRA (metrics.followup.done). followup_sent
    // pertenece al email automático post-llamada (post-call-handler/cron) y no
    // debe ocultar candidatos: un email automático no es el WhatsApp del dueño.
    // dedupeCalls aplica esa bandera A NIVEL DE CONTACTO (silencia hermanas)
    // y colapsa a UNA tarjeta por (teléfono + motivo), la más reciente.
    calls = dedupeCalls((data || []).filter(c => c.caller_number && c.caller_number !== 'unknown'));
  } catch (e) { log.warn(`getCandidates(${orgId}): ${e.message}`); return []; }
  if (!calls.length) return [];

  // Nombres de contacto (best-effort, por variantes del teléfono).
  const nameByPhone = {};
  try {
    const variants = [...new Set(calls.flatMap(c => phoneVariants(c.caller_number)))];
    if (variants.length) {
      const { data: contacts } = await db.client.from('contacts')
        .select('name, phone').eq('org_id', orgId).in('phone', variants);
      for (const ct of (contacts || [])) { const k = normalizePhone(ct.phone); if (k) nameByPhone[k] = ct.name; }
    }
  } catch (_) { /* sin nombres, se usa saludo genérico */ }

  return calls.map(c => {
    const name = nameByPhone[normalizePhone(c.caller_number)] || null;
    const reason = c.outcome || 'info';
    return {
      callId: c.id,
      phone: c.caller_number,
      name,
      reason,
      when: c.started_at,
      score: (c.metrics && c.metrics.audit && typeof c.metrics.audit.score === 'number') ? c.metrics.audit.score : null,
      draft: draftMessage({ name, reason, bizName, lang, assistantName }),
    };
  });
}

/**
 * Marca una llamada como ya seguida (enviado o descartado) → no reaparece.
 * Escribe en metrics.followup (bandera propia); NO toca followup_sent, que es
 * del email automático post-llamada. Merge lectura+escritura: el riesgo de
 * pisar metrics es mínimo (el audit escribe justo tras la llamada; esto, días
 * después).
 */
async function markDone(callId, orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !callId) return { ok: false };
  try {
    const { data: row } = await db.client.from('nf_calls')
      .select('metrics').eq('id', callId).eq('org_id', orgId).maybeSingle();
    if (!row) return { ok: false, error: 'not_found' };
    const metrics = Object.assign({}, row.metrics || {}, {
      followup: { done: true, at: new Date().toISOString(), channel: opts.channel || null },
    });
    const { error } = await db.client.from('nf_calls')
      .update({ metrics })
      .eq('id', callId).eq('org_id', orgId);
    return { ok: !error, error: error && error.message };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { draftMessage, getCandidates, markDone, dedupeCalls, followupKind, truncateSafe };
