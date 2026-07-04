// ============================================================
// NodeFlow — Registro canónico de sectores (2026-07-04)
// ------------------------------------------------------------
// Fuente ÚNICA de verdad por vertical. Antes el "conocimiento de
// sector" estaba desperdigado (switch del prompt-generator + campos
// de sector-fields). Aquí cada sector declara sus TRES pilares:
//
//   · normas[]        → reglas de comportamiento propias del sector,
//                       que se inyectan en el prompt del asistente.
//   · metricChecks[]  → qué debe verificar el AUDITOR en ese sector
//                       (lo que significa "bien hecho" aquí, no en general).
//   · requiredFields  → parámetros que el negocio debe capturar
//                       (se reutilizan de sector-fields.js).
//
// El bucle de mejora se vuelve sector-aware leyendo de aquí: el auditor
// juzga con metricChecks del sector, el agregador agrupa por sector y las
// reglas aprobadas se aplican a las normas DE ESE sector, no a todos.
// Determinista, sin I/O — testeable.
// ============================================================
'use strict';

const { SECTOR_REQUIRED_FIELDS } = require('../lifecycle/sector-fields');

// Sector por defecto: lo que aplica a cualquier negocio sin vertical propia.
const GENERICO = {
  slug: 'generico',
  label: 'Negocio',
  aliases: [],
  norms: [],
  metricChecks: [],
};

// Pilotos con normas + métricas propias (2026-07-04). El resto de los ~32
// sectores del prompt-generator caen a GENERICO hasta que se curen (Fase 5).
const SECTORS = {
  dental: {
    slug: 'dental',
    label: 'Clínica dental',
    aliases: ['clinica', 'dentista', 'odontologia', 'odontologo'],
    norms: [
      'Si es una primera visita, pregúntalo y para qué motivo (revisión, limpieza, dolor, urgencia).',
      'Ante dolor agudo o urgencia dental, priorízalo: ofrece el hueco más cercano posible.',
      'NUNCA des diagnósticos ni consejos clínicos: eso lo hace el profesional en consulta.',
    ],
    metricChecks: [
      { key: 'first_visit_asked', label: '¿Preguntó si es primera visita y el motivo?' },
      { key: 'urgency_triaged',   label: '¿Detectó y priorizó una urgencia o dolor?' },
      { key: 'no_medical_advice', label: '¿Evitó dar diagnóstico o consejo clínico?' },
    ],
  },
  peluqueria: {
    slug: 'peluqueria',
    label: 'Peluquería',
    aliases: ['peluqueria', 'barberia', 'estetica'],
    norms: [
      'Pregunta SIEMPRE qué servicio quiere (corte, tinte, mechas, peinado) — la duración y el hueco dependen de ello.',
      'Si el servicio es largo (tinte, mechas), tenlo en cuenta al ofrecer horario.',
      'Si menciona un profesional concreto, respétalo al buscar hueco.',
    ],
    metricChecks: [
      { key: 'service_captured',  label: '¿Capturó qué servicio quiere el cliente?' },
      { key: 'duration_aware',    label: '¿Tuvo en cuenta la duración del servicio al ofrecer hora?' },
    ],
  },
  restaurante: {
    slug: 'restaurante',
    label: 'Restaurante',
    aliases: ['restaurante', 'bar', 'cafeteria', 'gastrobar'],
    norms: [
      'Para CUALQUIER reserva pregunta SIEMPRE el número de comensales y la hora — sin eso no hay reserva.',
      'Pregunta si hay alergias o necesidades (trona para niños, terraza vs. interior) cuando encaje.',
      'No confirmes mesa sin comensales + hora.',
    ],
    metricChecks: [
      { key: 'guests_captured', label: '¿Capturó el número de comensales?' },
      { key: 'time_captured',   label: '¿Capturó la hora de la reserva?' },
    ],
  },
  taller: {
    slug: 'taller',
    label: 'Taller mecánico',
    aliases: ['taller', 'mecanico', 'chapa', 'neumaticos'],
    norms: [
      'Pregunta SIEMPRE la matrícula y qué necesita (revisión, ITV, ruido, avería concreta).',
      'Si el coche no arranca o es peligroso conducir, trátalo como urgente y ofrece lo antes posible.',
      'No des diagnósticos mecánicos por teléfono: el mecánico lo valora al ver el coche.',
    ],
    metricChecks: [
      { key: 'plate_captured',   label: '¿Capturó la matrícula?' },
      { key: 'service_captured', label: '¿Capturó qué necesita el vehículo?' },
      { key: 'urgency_triaged',  label: '¿Detectó una urgencia (coche no arranca)?' },
    ],
  },
};

/** Normaliza un slug: minúsculas, sin acentos, guiones bajos. */
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Índice de alias → sector canónico (una vez).
const _aliasIndex = (() => {
  const idx = {};
  for (const s of Object.values(SECTORS)) {
    idx[s.slug] = s.slug;
    for (const a of s.aliases || []) idx[_norm(a)] = s.slug;
  }
  return idx;
})();

/**
 * Resuelve un slug de sector (o alias) a su entrada canónica. Lo desconocido
 * cae a GENERICO — nunca null, para que el resto del sistema no tenga que
 * comprobar. Incluye requiredFields desde sector-fields.js.
 * @param {string} slug
 * @returns {{slug,label,aliases,norms,metricChecks,requiredFields}}
 */
function resolveSector(slug) {
  const key = _aliasIndex[_norm(slug)];
  const base = (key && SECTORS[key]) || GENERICO;
  return { ...base, requiredFields: SECTOR_REQUIRED_FIELDS[base.slug] || [] };
}

/** ¿Tiene este sector normas/métricas propias curadas (no cae a genérico)? */
function isCurated(slug) {
  return resolveSector(slug).slug !== 'generico';
}

module.exports = { resolveSector, isCurated, SECTORS, GENERICO };
