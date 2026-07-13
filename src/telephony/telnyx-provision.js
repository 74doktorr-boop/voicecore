// ============================================================
// NodeFlow — Auto-provisión de números Telnyx (2026-07-06)
// ------------------------------------------------------------
// Hasta ahora el pool era MANUAL: Unai compraba números a mano y los
// metía con addNumber(). A escala eso te bloquea: pool vacío = el cliente
// que paga no se activa hasta que intervienes.
//
// Este módulo compra un número por la API de Telnyx, lo apunta a la TeXML
// App de voz (connection_id) para que las llamadas entren al asistente, y
// lo devuelve para meterlo al pool. NUNCA lanza (best-effort): si no hay
// clave o Telnyx falla, devuelve null y el flujo cae al aviso al fundador
// de siempre — cero regresión.
//
// GOTCHA España: los números geográficos ES exigen bundle regulatorio
// (identidad + dirección) en Telnyx. Si tu cuenta lo requiere, crea un
// "requirement group" en el panel y pon su id en TELNYX_REQUIREMENT_GROUP_ID;
// se adjunta a la compra. Sin él, Telnyx puede rechazar el pedido — se
// registra el motivo con claridad.
//
// Env:
//   TELNYX_API_KEY               (obligatorio)
//   TELNYX_APP_ID                (TeXML App = connection_id de voz)
//   TELNYX_NUMBER_AREACODE       (opcional, p.ej. '843' Gipuzkoa)
//   TELNYX_REQUIREMENT_GROUP_ID  (opcional, bundle regulatorio ES)
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('TELNYX-PROV');

const BASE = 'https://api.telnyx.com/v2';
const MAX_TOPUP_PER_RUN = 5; // tope de seguridad: nunca comprar más de N de golpe

function isConfigured() {
  return !!(process.env.TELNYX_API_KEY && process.env.TELNYX_APP_ID);
}

function _headers() {
  return { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' };
}

// fetch con timeout, tolerante (AbortSignal.timeout está en Node 18+).
async function _fetch(fetchImpl, url, opts = {}, ms = 15000) {
  const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
  return fetchImpl(url, { ...opts, signal });
}

/**
 * Busca UN número ES de voz disponible, SOLO del prefijo configurado.
 *
 * INCIDENTE 2026-07-14: la versión anterior tenía un fallback silencioso a
 * "cualquier número local ES" cuando faltaba el prefijo o no había stock —
 * compró números 822 (Canarias) en vez de 843 (Gipuzkoa) con dinero real.
 * Regla nueva e innegociable: sin TELNYX_NUMBER_AREACODE configurado NO se
 * compra nada; y con prefijo, SOLO ese prefijo (si no hay stock → null y que
 * decida un humano). Nunca más comprar a ciegas.
 * @returns {Promise<string|null>} número en E.164 (+34…) o null.
 */
async function findAvailableNumber({ areaCode, fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const ac = areaCode || process.env.TELNYX_NUMBER_AREACODE;
  if (!ac) {
    log.error('auto-provisión BLOQUEADA: falta TELNYX_NUMBER_AREACODE (prefijo deseado, p.ej. 843) — no se compran números sin prefijo explícito');
    return null;
  }
  const qs = `filter[country_code]=ES&filter[phone_number_type]=local&filter[features][]=voice&filter[national_destination_code]=${encodeURIComponent(ac)}&filter[limit]=10`;
  try {
    const res = await _fetch(f, `${BASE}/available_phone_numbers?${qs}`, { headers: _headers() });
    if (!res.ok) { log.warn(`búsqueda de números HTTP ${res.status}`); return null; }
    const body = await res.json();
    const list = (body && body.data) || [];
    // Cinturón y tirantes: valida que el número devuelto empieza por +34<prefijo>
    // (no confiar a ciegas en el filtro del proveedor).
    const pick = list.find(n => n && n.phone_number && String(n.phone_number).startsWith(`+34${ac}`));
    if (!pick) { log.warn(`sin stock de números +34${ac} en Telnyx ahora mismo — no se compra nada`); return null; }
    return pick.phone_number;
  } catch (e) {
    log.warn(`búsqueda de números falló: ${e.message}`);
    return null;
  }
}

/**
 * Compra un número y lo apunta a la TeXML App de voz. Best-effort.
 * @returns {Promise<string|null>} el número comprado (E.164) o null.
 */
async function provisionNumber({ areaCode, fetchImpl } = {}) {
  if (!isConfigured()) return null;
  const f = fetchImpl || fetch;
  const connectionId = process.env.TELNYX_APP_ID;
  const requirementGroupId = process.env.TELNYX_REQUIREMENT_GROUP_ID || null;

  const number = await findAvailableNumber({ areaCode, fetchImpl: f });
  if (!number) { log.warn('auto-provisión: sin números ES de voz disponibles ahora mismo'); return null; }

  const phoneEntry = { phone_number: number };
  if (requirementGroupId) phoneEntry.requirement_group_id = requirementGroupId;

  try {
    const res = await _fetch(f, `${BASE}/number_orders`, {
      method: 'POST',
      headers: _headers(),
      body: JSON.stringify({ phone_numbers: [phoneEntry], connection_id: connectionId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (body && body.errors && body.errors.map(e => e.detail || e.title).join('; ')) || res.status;
      // El fallo regulatorio es el habitual en ES sin bundle: dilo claro.
      const regul = /regulat|requirement|identity|address/i.test(String(detail));
      log.error(`auto-provisión: Telnyx rechazó la compra de ${number}: ${detail}` +
        (regul && !requirementGroupId ? ' — parece regulatorio: crea un requirement group en Telnyx y ponlo en TELNYX_REQUIREMENT_GROUP_ID' : ''));
      return null;
    }
    const status = body && body.data && body.data.status;
    log.info(`auto-provisión: número ${number} comprado (pedido ${body?.data?.id || '?'}, estado ${status || '?'}, apuntado a la App ${connectionId})`);
    return number;
  } catch (e) {
    log.error(`auto-provisión: compra de ${number} falló: ${e.message}`);
    return null;
  }
}

/**
 * Rellena el pool hasta `target` números disponibles (con tope de seguridad).
 * Devuelve cuántos añadió. Para cron/admin; nunca lanza.
 * @param {object} deps { addNumber, getPoolStats } inyectables para test.
 */
async function topUpPool(target = 3, deps = {}) {
  if (!isConfigured()) return 0;
  const pool = deps.pool || require('./phone-pool');
  const addNumber = deps.addNumber || pool.addNumber;
  const getPoolStats = deps.getPoolStats || pool.getPoolStats;
  let added = 0;
  try {
    const stats = await getPoolStats();
    const need = Math.min(Math.max(0, target - (stats.available || 0)), MAX_TOPUP_PER_RUN);
    for (let i = 0; i < need; i++) {
      const num = await provisionNumber({ fetchImpl: deps.fetchImpl });
      if (!num) break; // sin stock o error → paramos, no reintentamos en bucle
      await addNumber({ phoneNumber: num, provider: 'telnyx', prefix: num.slice(0, 6) });
      added++;
    }
    if (added) log.info(`topUpPool: ${added} número(s) añadidos (objetivo ${target})`);
  } catch (e) { log.warn(`topUpPool falló: ${e.message}`); }
  return added;
}

module.exports = { isConfigured, findAvailableNumber, provisionNumber, topUpPool, MAX_TOPUP_PER_RUN };
