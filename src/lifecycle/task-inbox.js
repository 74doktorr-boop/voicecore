// ============================================================
// NodeFlow — Inbox de acciones que la IA llena sola (2026-07-08)
// ------------------------------------------------------------
// "Mis tareas con vida": el asistente le dice al dueño QUÉ hacer, no al revés.
// Este módulo es PURO y testeable (sin BD ni reloj): recibe las señales YA
// agregadas — las MISMAS que alimentan el briefing matinal (oportunidades sin
// responder, riesgo de plantón mañana, fichas en borrador que creó la IA,
// clientes inactivos recuperables, bonos a punto de agotarse/caducar) — y
// devuelve tareas SUGERIDAS ordenadas por urgencia (dinero/tiempo primero),
// sin ceros, dedup por key.
//
// La agregación de señales vive en GET /api/portal/tasks (routes-portal.js),
// que reusa _missedOpportunitiesList / _atRiskTomorrow / la señal de
// reactivación — para que la cifra sea SIEMPRE la misma en el briefing, en la
// sección y en el contador del nav (una sola fuente de verdad).
//
// Descarte: cada tarea se puede "Descartar" y se PERSISTE en
// automation_config.config._dismissedTasks (mapa dismissKey → caducidadISO) con
// TTL para que un "riesgo de mañana" descartado hoy resurja cuando vuelva a ser
// real. dismissKeyFor incluye la fecha en las señales efímeras (dismissScope).
// ============================================================
'use strict';

// Un descarte no es para siempre: caduca a los N días para que la sugerencia
// pueda volver cuando vuelva a tener sentido (idéntico "riesgo mañana" otro día
// ya lleva otra dismissKey por la fecha; este TTL cubre las señales sin fecha).
const DISMISS_TTL_DAYS = 30;

// Prioridad por tipo de señal: dinero y tiempo mandan; el resto detrás. A menor
// número, más arriba. (money y time comparten cabecera; se desempata por valor.)
const SECTION_RANK = {
  oportunidades: 1, // lead que llamó y no reservó → dinero en la puerta
  clientes:      2, // inactivo recuperable → dinero dormido
  citas:         3, // riesgo de plantón mañana → tiempo, urgente
  entidades:     4, // borrador / bono → mantenimiento de fichas
};

function euros(n) {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? v.toLocaleString('es-ES') : '';
}

// Nombre presentable para el saludo de la tarea: el que haya, o "el cliente".
function who(name) {
  const n = (name || '').trim();
  return n || 'el cliente';
}

/**
 * Construye las tareas sugeridas a partir de las señales agregadas.
 * PURA: mismas señales = mismo resultado. NO consulta dismissed (eso lo hace
 * filterDismissed sobre el resultado, para poder testear por separado).
 *
 * @param {object|null} signals
 *   { missedOpportunities:[{phone,name,lastCallId}],
 *     atRiskTomorrow:{date, list:[{id,patientName,time}]},
 *     draftEntities:[{id,display_name,type_label}],
 *     inactiveClients:{count,euros},
 *     expiringBonos:[{id,display_name,remaining,daysToExpiry,ownerName}] }
 * @param {{today?:string}} opts  fecha civil de HOY (YYYY-MM-DD) para dismissScope
 * @returns {Array<{key,icon,text,urgency,section,sourceId,dismissScope?}>}
 */
function buildSuggestedTasks(signals, opts) {
  const s = signals || {};
  const today = (opts && opts.today) || null;
  const out = [];
  const seen = new Set(); // dedup por key

  const push = (t) => {
    if (!t || !t.key || seen.has(t.key)) return;
    seen.add(t.key);
    out.push(t);
  };

  // 1) Oportunidad sin responder — llamó y no reservó. Dedup por teléfono.
  for (const o of (s.missedOpportunities || [])) {
    if (!o || !o.phone) continue;
    push({
      key: 'opp:' + o.phone,
      icon: '📞',
      text: 'Llama a ' + who(o.name) + ' — consultó y no reservó',
      urgency: { kind: 'money', value: 0 }, // dinero en la puerta; sin € estimado por lead
      section: 'oportunidades',
      sourceId: o.lastCallId || o.phone,
    });
  }

  // 2) Cliente inactivo recuperable — un único agregado (count + € honesto).
  const inact = s.inactiveClients || {};
  const inactCount = parseInt(inact.count, 10);
  if (Number.isFinite(inactCount) && inactCount > 0) {
    const e = Math.max(0, Number(inact.euros) || 0);
    const label = inactCount === 1 ? 'cliente inactivo' : 'clientes inactivos';
    const eur = euros(e);
    push({
      key: 'inactive',
      icon: '💶',
      text: eur
        ? 'Recupera ' + inactCount + ' ' + label + ' — ~' + eur + '€ dormidos'
        : 'Escribe a ' + inactCount + ' ' + label + ' — un mensaje los trae de vuelta',
      urgency: { kind: 'money', value: e },
      section: 'clientes',
      sourceId: 'inactive',
    });
  }

  // 3) Riesgo de plantón MAÑANA — confirmar hoy. Efímera: dismissScope=fecha.
  const risk = s.atRiskTomorrow || {};
  for (const a of (risk.list || [])) {
    if (!a || !a.id) continue;
    push({
      key: 'atrisk:' + a.id,
      icon: '⚠️',
      text: 'Confirma la cita de ' + who(a.patientName) +
            (a.time ? ' (mañana ' + a.time + ')' : ' de mañana') + ' — riesgo de plantón',
      urgency: { kind: 'time', value: 1 },
      section: 'citas',
      sourceId: a.id,
      dismissScope: risk.date || today || '',
    });
  }

  // 4) Ficha en borrador creada por la IA — completar los datos que faltan.
  for (const d of (s.draftEntities || [])) {
    if (!d || !d.id) continue;
    const label = (d.display_name || d.type_label || 'ficha').trim();
    push({
      key: 'draft:' + d.id,
      icon: '📝',
      text: 'Completa la ficha ' + (d.display_name ? 'del ' + label : 'que preparó tu asistente'),
      urgency: { kind: 'time', value: 0 },
      section: 'entidades',
      sourceId: d.id,
    });
  }

  // 5) Bono a punto de agotarse/caducar — avisar antes de que se pierda.
  for (const b of (s.expiringBonos || [])) {
    if (!b || !b.id) continue;
    const rem = parseInt(b.remaining, 10);
    const remTxt = Number.isFinite(rem) && rem > 0
      ? (rem === 1 ? 'le queda 1 sesión' : 'le quedan ' + rem + ' sesiones')
      : 'está a punto de caducar';
    push({
      key: 'bono:' + b.id,
      icon: '⏳',
      text: 'Avisa a ' + who(b.ownerName) + ' — su "' + (b.display_name || 'bono') + '" ' + remTxt,
      urgency: { kind: 'money', value: 0 },
      section: 'entidades',
      sourceId: b.id,
    });
  }

  // Orden: por rango de sección (dinero/tiempo primero), y a igualdad por € desc.
  out.sort((a, b) => {
    const ra = SECTION_RANK[a.section] || 99;
    const rb = SECTION_RANK[b.section] || 99;
    if (ra !== rb) return ra - rb;
    const va = a.urgency && a.urgency.kind === 'money' ? a.urgency.value : 0;
    const vb = b.urgency && b.urgency.kind === 'money' ? b.urgency.value : 0;
    return vb - va;
  });

  return out;
}

// Clave con la que se PERSISTE un descarte. Para señales efímeras (riesgo de
// mañana) incluimos la fecha (dismissScope) para que el mismo apt otro día NO
// quede descartado — resurge cuando vuelve a ser real.
function dismissKeyFor(task) {
  if (!task) return '';
  const base = task.key || (task.section + ':' + (task.sourceId || ''));
  return task.dismissScope ? base + '@' + task.dismissScope : base;
}

// Quita de la lista las tareas cuyo descarte sigue vivo (no caducado).
function filterDismissed(tasks, dismissed, now) {
  const map = dismissed || {};
  const ref = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return (tasks || []).filter((t) => {
    const exp = map[dismissKeyFor(t)];
    if (!exp) return true;                 // nunca descartada
    return new Date(exp).getTime() <= ref; // caducado → vuelve a mostrarse
  });
}

// Devuelve una copia del mapa sin las entradas ya caducadas (para no engordar
// automation_config sin fin). No muta el original.
function pruneDismissed(dismissed, now) {
  const map = dismissed || {};
  const ref = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  const out = {};
  for (const [k, exp] of Object.entries(map)) {
    if (new Date(exp).getTime() > ref) out[k] = exp;
  }
  return out;
}

// Devuelve una copia del mapa con un nuevo descarte (caducidad a TTL días).
// No muta el original — read-merge-write lo persiste el endpoint.
function addDismissal(dismissed, dismissKey, now) {
  const base = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  const exp = new Date(base + DISMISS_TTL_DAYS * 86400000).toISOString();
  return { ...(dismissed || {}), [dismissKey]: exp };
}

module.exports = {
  buildSuggestedTasks, dismissKeyFor, filterDismissed,
  pruneDismissed, addDismissal, DISMISS_TTL_DAYS, SECTION_RANK,
};
