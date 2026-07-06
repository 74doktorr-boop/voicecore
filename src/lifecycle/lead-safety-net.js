// ============================================================
// NodeFlow — Red de seguridad de leads y nombres (server-side)
// Caso real (llamada aca3576c, 2026-07-04): el asistente dijo
// "voy a registrar su interés y el equipo le llamará" y NO invocó
// register_lead (metrics.toolCalls: 0). La promesa quedó vacía:
// sin lead, sin aviso al dueño, contacto sin nombre.
// Es el fallo clásico del LLM de verbalizar la acción sin
// ejecutarla — y por charter, las consecuencias de negocio no
// pueden depender de que el LLM se acuerde: esta red corre tras
// CADA llamada, es determinista y usa el análisis post-call que
// ya existía. Si la llamada terminó en callback_requested y el
// tool no se usó, el lead se crea igual y el dueño se entera.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('LEAD-NET');

// Mismos genéricos que el fichaje de contactos del post-call (bug real:
// contacto guardado como "cliente").
const GENERIC_NAME = /^(el\s+|la\s+)?(cliente|clienta|desconocid[oa]|usuario|se[ñn]or(a)?|customer|unknown)$/i;

/** ¿Es un nombre real utilizable para fichar? */
function isUsableName(raw) {
  const name = String(raw || '').trim();
  return name.length > 1 && !GENERIC_NAME.test(name);
}

// Rechazo EXPLÍCITO del cliente. Caso real (2026-07-07): el cliente dijo
// "no me interesa", el analizador clasificó callback_requested igualmente
// (el asistente había prometido aviso) y el dueño recibió un "lead
// recuperado" falso. Un lead de alguien que dijo NO quema la confianza en
// las notificaciones. Determinista por charter: no confiamos en que el
// LLM clasifique mejor — se comprueba lo que el cliente DIJO.
// OJO: clases Unicode (\p{L}) y flag u — \w no incluye acentos/ñ y
// "llaméis" no casaría (mismo demonio que el troceador del navegador).
const REJECTION = /\b(no\s+(me|nos)\s+interesa\p{L}*|no\s+estoy\s+interesad[oa]|no\s+quiero\s+(nada|que\s+me\s+llam\p{L}+|contratar)|no\s+hace\s+falta\s+que\s+me\s+llam\p{L}+|no\s+me\s+llam[eé]is|solo\s+(estaba\s+)?(preguntando|curioseando|mirando)|era\s+solo\s+curiosidad|d[eé]jalo,?\s+gracias)/iu;

/** ¿El cliente rechazó explícitamente en algún turno? PURA. */
function saidNotInterested(transcript) {
  for (const t of (Array.isArray(transcript) ? transcript : [])) {
    if (t && t.role === 'user' && REJECTION.test(String(t.content || ''))) return true;
  }
  return false;
}

/**
 * Aplica la red tras el análisis del transcript:
 *  a) ficha el nombre que el llamante dio para sí mismo (si el contacto
 *     estaba sin nombre o con un genérico), y
 *  b) si el asistente prometió que el equipo llamará (outcome
 *     callback_requested) pero register_lead NUNCA se ejecutó, crea el
 *     lead y avisa al dueño — marcado como recuperado por la red.
 *
 * Nunca lanza. Devuelve { leadRecovered, nameUpdated } para log/tests.
 */
async function applyLeadSafetyNet(
  { analysis, contactId, orgId, callerNumber, leadRegistered, callSessionId, transcript },
  deps = {}
) {
  const result = { leadRecovered: false, nameUpdated: false, rejected: false };
  const db = deps.db || require('../db/database').getDatabase();
  const notify = deps.notify || ((msg, bizId) => {
    try { require('../tools/executor')._notifyOwner(msg, bizId); } catch (_) {}
  });

  if (!analysis || !db.enabled || !orgId) return result;
  const xd = analysis.extracted_data || {};

  // a) Nombre del llamante → contacto (solo pisa null/genéricos)
  try {
    if (isUsableName(xd.nombre_llamante) && callerNumber) {
      const name = String(xd.nombre_llamante).trim();
      await db.client.from('contacts')
        .update({ name })
        .eq('org_id', orgId)
        .eq('phone', callerNumber)
        .or('name.is.null,name.ilike.cliente,name.ilike.clienta,name.ilike.usuario,name.ilike.desconocido,name.ilike.desconocida,name.ilike.customer,name.ilike.unknown');
      result.nameUpdated = true;
      log.info(`[${callSessionId}] Contacto fichado por la red: ${name} (${callerNumber})`);
    }
  } catch (e) {
    log.warn(`[${callSessionId}] fichaje de nombre falló: ${e.message}`);
  }

  // b) Lead prometido y no registrado → se crea igual…
  //    …SALVO que el cliente dijera explícitamente que NO le interesa:
  //    entonces ni lead ni notificación (falso "lead recuperado" real 2026-07-07).
  try {
    if (!leadRegistered && analysis.outcome === 'callback_requested' && saidNotInterested(transcript)) {
      result.rejected = true;
      log.info(`[${callSessionId}] Lead NO recuperado: el cliente rechazó explícitamente ("no me interesa")`);
    } else if (!leadRegistered && analysis.outcome === 'callback_requested') {
      const name = isUsableName(xd.nombre_llamante) ? String(xd.nombre_llamante).trim() : '';
      await db.client.from('leads').insert({
        org_id:     orgId,
        name,
        phone:      callerNumber || '',
        need:       xd.interes || analysis.summary || null,
        notes:      'Recuperado por la red de seguridad: el asistente prometió aviso pero no registró el lead durante la llamada.',
        urgency:    'media',
        source:     'voice_call_safety_net',
        created_at: new Date().toISOString(),
      });
      result.leadRecovered = true;
      log.info(`[${callSessionId}] LEAD RECUPERADO por la red (${name || 'sin nombre'}, ${callerNumber})`);
      notify(
        `👤 *Nuevo lead — recuperado por NodeFlow*\n` +
        `━━━━━━━━━━━━\n` +
        `👤 ${name || 'No dio nombre'}\n📞 ${callerNumber || 'desconocido'}\n` +
        (xd.interes ? `Interés: ${xd.interes}\n` : '') +
        `━━━━━━━━━━━━\nEl asistente prometió que le llamaréis. NodeFlow IA`,
        orgId
      );
    }
  } catch (e) {
    log.warn(`[${callSessionId}] recuperación de lead falló: ${e.message}`);
  }

  return result;
}

module.exports = { applyLeadSafetyNet, isUsableName, saidNotInterested };
