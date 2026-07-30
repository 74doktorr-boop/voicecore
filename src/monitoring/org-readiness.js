'use strict';
// ============================================================
// NodeFlow — ¿Está este negocio en condiciones de atender?
//
// POR QUÉ EXISTE (2026-07-30):
// Al revisar las organizaciones de producción, 3 de 4 no tenían `schedule` ni
// `mode` en su `assistant_config`. Se dieron de alta, se les asignó número, y
// el alta nunca se terminó. Nadie se enteró en semanas.
//
// EL FALLO GRAVE NO ES QUE FALTE: es lo que pasa cuando falta.
//
// El prompt es tajante — "NO INVENTES NADA... si un dato no figura
// EXPLÍCITAMENTE, para ti NO EXISTE"— y sin horario configurado pone
// literalmente "HORARIO: Consultar horario". La IA, obediente, no se inventa
// las horas cuando se las preguntan.
//
// Pero `toSchedulerConfig` cae a DEFAULT_SCHEDULE (L-J 9-14 y 15:30-19:30,
// V 9-14) cuando no hay horario. Así que la asistente NO DICE el horario y a la
// vez SÍ RESERVA citas dentro de uno inventado. Un cliente de Osakin —que abre
// hasta las 20h y los viernes por la tarde— saldría con una cita confirmada
// para una hora en que la clínica está cerrada, o no conseguiría una hora en la
// que sí está abierta.
//
// El default existe por una razón defendible (mejor eso que "negocio no
// configurado" eterno) y no se toca aquí. Lo que se arregla es que sea INVISIBLE.
//
// Solo se juzgan orgs CON número asignado: sin número no entra ninguna llamada
// y nada de esto tiene consecuencia.
//
// Todo PURO: entra la fila de organizations, sale qué le falta y qué provoca.
// ============================================================

// Ordenadas por consecuencia real, no por orden de formulario. Lo primero de la
// lista es lo que produce un cliente enfadado; lo último, una llamada mediocre.
const REQUISITOS = [
  {
    campo: 'schedule',
    gravedad: 'critico',
    falta: 'sin horario configurado',
    consecuencia: 'reserva citas en un horario INVENTADO (L-J 9-14 y 15:30-19:30, V 9-14). Si sus horas reales son otras, está citando gente cuando el negocio está cerrado.',
  },
  {
    campo: 'services',
    gravedad: 'critico',
    falta: 'sin servicios',
    consecuencia: 'no puede decir qué hacéis ni cuánto cuesta, y toda llamada de información acaba en "el equipo se lo confirma".',
  },
  {
    campo: 'mode',
    gravedad: 'aviso',
    falta: 'sin modo (citas / recados)',
    consecuencia: 'no sabe si su trabajo es agendar o tomar recados.',
  },
  {
    campo: 'firstMessage',
    gravedad: 'aviso',
    falta: 'sin saludo propio',
    consecuencia: 'contesta con la fórmula genérica.',
  },
];

const _vacio = (v) => v == null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Qué le falta a una organización para atender bien. PURA.
 *
 * @param {{name?:string, assistant_config?:object, automation_config?:object}} org
 * @returns {{negocio:string, gravedad:'ok'|'aviso'|'critico', faltan:Array<{campo,falta,consecuencia,gravedad}>}}
 */
function orgReadiness(org = {}) {
  const cfg = org.assistant_config || {};
  // Los servicios viven en dos sitios según por dónde se dio de alta: la lista
  // estructurada del portal y el campo del asistente. Cualquiera de los dos vale.
  const listaEstructurada = org.automation_config && org.automation_config.config
    && org.automation_config.config.serviceList;

  const faltan = [];
  for (const r of REQUISITOS) {
    const valor = r.campo === 'services'
      ? (!_vacio(cfg.services) ? cfg.services : listaEstructurada)
      : cfg[r.campo];
    if (_vacio(valor)) faltan.push({ ...r });
  }

  const gravedad = faltan.some(f => f.gravedad === 'critico') ? 'critico'
    : faltan.length ? 'aviso' : 'ok';

  return { negocio: org.name || '(sin nombre)', gravedad, faltan };
}

/** Una línea legible para el informe. PURA. */
function resumirFaltas(estado) {
  if (!estado || !estado.faltan || !estado.faltan.length) return '';
  return estado.faltan.map(f => f.falta).join(' · ');
}

module.exports = { orgReadiness, resumirFaltas, REQUISITOS };
