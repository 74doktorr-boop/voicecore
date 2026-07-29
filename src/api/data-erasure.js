'use strict';
// ============================================================
// NodeFlow — Derecho de supresión (RGPD art. 17), operativo.
//
// POR QUÉ EXISTE (auditoría 2026-07-29):
// La política de privacidad promete el derecho de supresión y las Condiciones
// dicen que "los datos se suprimen o devuelven al terminar la relación". En el
// código NO EXISTÍA NADA: el único borrado de una organización era admin-only y
// un SOFT-delete (is_active:false, status:'deleted'), así que los datos
// personales —incluidos los de los clientes finales del negocio, que son
// terceros— seguían íntegros en Supabase indefinidamente. No había purga, ni
// anonimización, ni retención automática. Una reclamación ante la AEPD hoy no se
// podía atender con ninguna herramienta: había que borrar a mano.
//
// DECISIÓN DE DISEÑO: esto NO es self-service de un clic. Un borrado
// irreversible disparado por un botón en el portal es una catástrofe esperando
// a ocurrir. El derecho tiene que poder ATENDERSE, no ser instantáneo: el motor
// es determinista y auditable, y lo ejecuta una persona autorizada.
//
// Orden de borrado: primero lo que depende de otras cosas, luego la raíz. Todas
// las tablas se filtran SIEMPRE por organización — un borrado sin filtro de org
// sería el peor incidente posible del producto.
// ============================================================

/**
 * Plan de borrado. `orgCols` lista los nombres posibles de la columna de
 * organización porque el esquema usa `org_id` en unas tablas y
 * `organization_id` en otras; el motor prueba en orden y usa la que funcione.
 * `motivo` documenta QUÉ dato personal contiene, para poder revisarlo.
 */
const ERASURE_PLAN = [
  { tabla: 'nf_wa_messages',      orgCols: ['org_id', 'organization_id'], motivo: 'mensajes de WhatsApp con clientes finales' },
  { tabla: 'scheduled_reminders', orgCols: ['org_id', 'organization_id'], motivo: 'avisos programados con teléfono y nombre' },
  { tabla: 'nf_campaign_calls',   orgCols: ['org_id', 'organization_id'], motivo: 'cola de llamadas salientes' },
  { tabla: 'nf_calls',            orgCols: ['org_id', 'organization_id'], motivo: 'transcripciones y decisiones de la IA' },
  { tabla: 'nf_appointments',     orgCols: ['organization_id', 'org_id'], motivo: 'citas con nombre, teléfono y servicio' },
  { tabla: 'nf_waitlist',         orgCols: ['org_id', 'organization_id'], motivo: 'lista de espera' },
  { tabla: 'nf_tasks',            orgCols: ['org_id', 'organization_id'], motivo: 'tareas con datos de clientes' },
  { tabla: 'nf_entity_events',    orgCols: ['organization_id', 'org_id'], motivo: 'histórico de fichas vivas' },
  { tabla: 'nf_entities',         orgCols: ['organization_id', 'org_id'], motivo: 'fichas (vehículos, mascotas, pólizas…)' },
  { tabla: 'contact_memory',      orgCols: ['org_id', 'organization_id'], motivo: 'memoria y preferencias del cliente final' },
  { tabla: 'contacts',            orgCols: ['org_id', 'organization_id'], motivo: 'la agenda de clientes del negocio' },
  { tabla: 'knowledge_chunks',    orgCols: ['org_id', 'organization_id'], motivo: 'base de conocimiento del negocio' },
  { tabla: 'leads',               orgCols: ['org_id', 'organization_id'], motivo: 'leads captados' },
  { tabla: 'usage',               orgCols: ['org_id', 'organization_id'], motivo: 'consumo (se conserva la factura en Stripe, no aquí)' },
];

/** Tablas que NO se borran, y por qué. Explícito para poder discutirlo. */
const SE_CONSERVA = [
  ['audit_log', 'registro de acciones de administración: obligación de rendición de cuentas (art. 5.2 RGPD). No contiene datos de clientes finales.'],
  ['organizations', 'la fila de la organización se marca como suprimida, no se elimina: hace falta para no reasignar su número ni reutilizar su identificador.'],
];

/**
 * Ejecuta (o simula) la supresión de todos los datos personales de una org.
 *
 * @param {object} db      wrapper de base de datos (con .client de Supabase)
 * @param {string} orgId
 * @param {{dryRun?: boolean, plan?: Array}} opts  dryRun=true solo CUENTA
 * @returns {Promise<{ok:boolean, dryRun:boolean, orgId:string, tablas:Array, total:number, errores:Array}>}
 */
async function eraseOrgData(db, orgId, opts = {}) {
  const dryRun = opts.dryRun !== false;          // por defecto SIMULA: borrar exige pedirlo
  const plan = opts.plan || ERASURE_PLAN;
  if (!orgId || typeof orgId !== 'string') throw new Error('eraseOrgData: orgId requerido');
  if (!db || !db.client) throw new Error('eraseOrgData: base de datos no disponible');

  const tablas = [];
  const errores = [];
  let total = 0;

  for (const paso of plan) {
    let hecho = false;
    for (const col of paso.orgCols) {
      try {
        const q = dryRun
          ? await db.client.from(paso.tabla).select('*', { count: 'exact', head: true }).eq(col, orgId)
          : await db.client.from(paso.tabla).delete({ count: 'exact' }).eq(col, orgId);
        if (q.error) {
          // Columna o tabla inexistente → se prueba el siguiente nombre de columna.
          if (_esFaltaDeEsquema(q.error)) continue;
          throw new Error(q.error.message);
        }
        const n = Number(q.count) || 0;
        tablas.push({ tabla: paso.tabla, columna: col, filas: n, motivo: paso.motivo });
        total += n;
        hecho = true;
        break;
      } catch (e) {
        errores.push({ tabla: paso.tabla, columna: col, error: e.message });
      }
    }
    // Que una tabla no exista en este entorno NO es un error: se anota y se sigue.
    if (!hecho && !errores.some(e => e.tabla === paso.tabla)) {
      tablas.push({ tabla: paso.tabla, columna: null, filas: 0, motivo: paso.motivo, nota: 'tabla o columna no encontrada' });
    }
  }

  return { ok: errores.length === 0, dryRun, orgId, tablas, total, errores, seConserva: SE_CONSERVA };
}

function _esFaltaDeEsquema(error) {
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205'
      || /does not exist|could not find/i.test(msg);
}

module.exports = { eraseOrgData, ERASURE_PLAN, SE_CONSERVA };
