// ============================================================
// NodeFlow — Renovación de tokens de WhatsApp de número propio
// (2026-07-07). La configuración del Embedded Signup emite tokens
// de integración empresarial que CADUCAN A LOS 60 DÍAS; sin esto,
// cada negocio conectado dejaría de enviar avisos a los 2 meses.
//
// Reloj de caducidad sin migración: updated_at de whatsapp_accounts
// se resetea en cada guardado del token, así que "updated_at con
// más de 45 días" = candidato a renovar. El margen de 15 días da
// ~15 reintentos diarios antes de la caducidad real; si aun así
// falla (token revocado por el negocio), se avisa al error tracker
// y el mensaje cae al número compartido de NodeFlow (fail-open).
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('WA-TOKEN-REFRESH');

const REFRESH_AFTER_DAYS = 45;

function _defaultListStaleAccounts() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return sb.from('whatsapp_accounts')
    .select('organization_id, updated_at')
    .eq('status', 'active')
    .is('api_base', null) // solo Meta directo (los tokens 360dialog legacy no son nuestros)
    .lt('updated_at', cutoff)
    .then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data || [];
    });
}

/**
 * Renueva los tokens con más de REFRESH_AFTER_DAYS días.
 * Nunca lanza; devuelve el resumen { checked, refreshed, failed }.
 */
async function refreshExpiringWaTokens(deps = {}) {
  const listStale = deps.listStale || _defaultListStaleAccounts;
  const getCreds = deps.getCreds || require('./accounts').getWaCredentials;
  const refresh = deps.refresh || require('./meta-connect').refreshBusinessToken;
  const updateToken = deps.updateToken || require('./accounts').updateWaAccessToken;

  const summary = { checked: 0, refreshed: 0, failed: 0 };
  let stale = [];
  try { stale = await listStale(); } catch (e) {
    log.warn(`refreshExpiringWaTokens: no se pudo listar cuentas: ${e.message}`);
    return summary;
  }

  for (const acc of stale) {
    summary.checked++;
    const orgId = acc.organization_id;
    try {
      const creds = await getCreds(orgId);
      if (!creds || !creds.accessToken) { summary.failed++; continue; }
      const out = await refresh(creds.accessToken, deps);
      if (!out.ok) {
        summary.failed++;
        log.error(`[${orgId}] renovación de token falló: ${out.error}`);
        continue;
      }
      await updateToken(orgId, out.token);
      summary.refreshed++;
    } catch (e) {
      summary.failed++;
      log.error(`[${orgId}] renovación de token: ${e.message}`);
    }
  }
  if (summary.checked > 0) {
    log.info(`Renovación WA: ${summary.refreshed}/${summary.checked} tokens renovados` +
      (summary.failed ? ` (${summary.failed} fallos — reintento mañana)` : ''));
  }
  return summary;
}

// ── Cron: cada día 03:10 Madrid, solo el líder ───────────────
let _interval = null, _lastRun = null;
function startWaTokenRefreshCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    if (!require('../utils/leader').isLeader()) return;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date()).map(p => [p.type, p.value]));
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (`${parts.hour}:${parts.minute}` === '03:10' && _lastRun !== today) {
      _lastRun = today;
      refreshExpiringWaTokens().catch(e => log.error(`wa-token-refresh cron: ${e.message}`));
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Cron de renovación de tokens WA iniciado — cada día 03:10 Madrid');
}
function stopWaTokenRefreshCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = { refreshExpiringWaTokens, startWaTokenRefreshCron, stopWaTokenRefreshCron, REFRESH_AFTER_DAYS };
