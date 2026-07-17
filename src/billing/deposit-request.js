'use strict';
// ============================================================
// NodeFlow — Solicitud de señal / depósito al reservar (2026-07-17)
// ------------------------------------------------------------
// Objeción de 16 sectores en la crítica sectorial: "un recordatorio no frena
// el no-show caro; hace falta cobrar señal/depósito". v1 SEGURA y honesta:
// NodeFlow NO procesa el dinero (eso es Stripe Connect, post-lanzamiento) — al
// reservar, envía al cliente la petición de señal con el ENLACE DE PAGO PROPIO
// del negocio (su Payment Link de Stripe, Bizum, etc.) por la portadora WA
// nodeflow_aviso. Opt-in por negocio, OFF por defecto → cero riesgo.
//
// Config: automation_config.config.deposit = { enabled, amountText, url }
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('DEPOSIT');

/** Devuelve la config de señal si está ACTIVA y usable, o null. PURA. */
function depositConfig(org) {
  const d = org && org.automation_config && org.automation_config.config && org.automation_config.config.deposit;
  if (!d || !d.enabled || !d.url) return null;
  return d;
}

/** Cuerpo del mensaje (el {{3}} de nodeflow_aviso: "Hola X, un mensaje de Y: <esto>"). PURA. */
function buildDepositBody(deposit, dateStr) {
  const amount = String(deposit.amountText || '').trim();
  const amountPhrase = !amount ? 'una señal'
    : /€|euro|señal|bizum|dep[oó]sito/i.test(amount) ? amount
    : `una señal de ${amount}`;
  return `para confirmar tu cita${dateStr ? ' del ' + dateStr : ''} necesitamos ${amountPhrase}. Puedes dejarla aquí: ${deposit.url}`;
}

// Cache corto de la org (no leer la BD por cada reserva).
const _cache = new Map();
async function _org(orgId, opts) {
  if (opts.org !== undefined) return opts.org;
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return null;
  const now = opts.now || Date.now();
  const hit = _cache.get(orgId);
  if (!opts.noCache && hit && now - hit.ts < 60000) return hit.org;
  let org = null;
  try {
    const { data } = await db.client.from('organizations')
      .select('name,language,automation_config').eq('id', orgId).maybeSingle();
    org = data;
  } catch (e) { log.warn(`_org(${orgId}): ${e.message}`); }
  _cache.set(orgId, { org, ts: now });
  return org;
}
function _clearCache() { _cache.clear(); }

/**
 * Si el negocio tiene señal ACTIVA, envía al cliente la petición con su enlace.
 * Fire-and-forget, fail-open, NO-OP si no está configurada. deps inyectables.
 */
async function maybeRequestDeposit(apt, businessId, opts = {}) {
  try {
    if (!apt || !apt.phone || !businessId) return { requested: false };
    const org = await _org(businessId, opts);
    const deposit = depositConfig(org);
    if (!deposit) return { requested: false, skipped: true };

    const bizName = (org && org.name) || 'el negocio';
    const lang    = (org && org.language) || 'es';
    const name    = String(apt.patientName || '').split(' ')[0] || '';
    const body    = buildDepositBody(deposit, opts.dateStr || null);

    const sendTemplate     = opts.sendTemplate     || require('../notifications/client-whatsapp').sendTemplate;
    const getWaCredentials = opts.getWaCredentials || require('../whatsapp/accounts').getWaCredentials;
    const { templateLanguage } = require('../whatsapp/templates');

    const credentials = await getWaCredentials(businessId);
    const params = [{ type: 'body', parameters: [
      { type: 'text', text: name || 'hola' },
      { type: 'text', text: bizName },
      { type: 'text', text: body },
    ] }];
    const r = await sendTemplate(apt.phone, 'nodeflow_aviso', templateLanguage('nodeflow_aviso', lang), params, credentials);
    if (r && r.ok) {
      log.info(`Señal solicitada → ${apt.id} (${apt.phone})`);
      try { require('../whatsapp/wa-log').logWaMessage({ orgId: businessId, phone: apt.phone, direction: 'out', body: `Solicitud de señal: ${deposit.url}`, kind: 'senal' }); } catch (_) {}
      return { requested: true };
    }
    log.warn(`Señal no enviada para ${apt.id}: ${r && r.error}`);
    return { requested: false };
  } catch (e) { log.warn(`maybeRequestDeposit: ${e.message}`); return { requested: false }; }
}

module.exports = { depositConfig, buildDepositBody, maybeRequestDeposit, _clearCache };
