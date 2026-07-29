'use strict';
// ============================================================
// NodeFlow — Digest matinal del fundador (08:00 Madrid)
// ------------------------------------------------------------
// La cabina "Necesita tu atención" del admin, por email — pero SOLO
// si hay algo que atender. Cubre lo OPERATIVO que no cubre el email
// de salud de clientes (09:30, client-health.js): clientes pagados
// sin número (dinero parado), pool de números vacío/bajo, config del
// servidor incompleta y calidad del número de WhatsApp.
//
// Si no hay nada: no envía (cero ruido). Env: FOUNDER_DIGEST_DISABLED=true
// para apagarlo. Destino: NOTIFY_EMAIL. Fail-open en cada fuente.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('FOUNDER-DIGEST');

function _has(k) { return !!(process.env[k] && String(process.env[k]).trim()); }

// Clientes pagados (registros activos) cuya org no tiene número asignado.
async function _pendingOnboarding(db) {
  const { data: registros } = await db.client.from('registros')
    .select('negocio, email').eq('status', 'active').limit(100);
  if (!registros?.length) return [];
  const emails = registros.map(r => r.email);
  const { data: orgs } = await db.client.from('organizations')
    .select('owner_email, automation_config').in('owner_email', emails).eq('is_active', true);
  const byEmail = {};
  for (const o of (orgs || [])) byEmail[o.owner_email] = o;
  return registros.filter(r => {
    const org = byEmail[r.email];
    return !(org && org.automation_config?.config?.nodeflowNumber);
  });
}

async function _waQuality() {
  if (!_has('WA_PHONE_NUMBER_ID') || !_has('WA_ACCESS_TOKEN')) return null;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}?fields=quality_rating`, {
      headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(4000),
    });
    const d = await r.json();
    return d.quality_rating || null;
  } catch (_) { return null; }
}

/**
 * Reúne los avisos operativos. @returns {Promise<Array<{sev,txt,sub}>>}
 */
async function collectDigestItems(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  if (!db.enabled) return [];
  const items = [];

  // 1) Dinero parado: pagados sin número
  try {
    const pending = await _pendingOnboarding(db);
    if (pending.length) items.push({
      sev: 'crit',
      txt: `${pending.length} cliente(s) pagado(s) SIN número — no reciben llamadas`,
      sub: pending.slice(0, 3).map(c => c.negocio).join(', ') + (pending.length > 3 ? '…' : ''),
    });
  } catch (e) { log.warn(`digest onboarding: ${e.message}`); }

  // 2) Pool de números
  try {
    const { getPoolStats } = deps.poolStats ? { getPoolStats: deps.poolStats } : require('../telephony/phone-pool');
    const s = await getPoolStats();
    if (s.available === 0) items.push({ sev: 'crit', txt: 'Pool de números VACÍO — no puedes dar de alta clientes', sub: `${s.assigned || 0} asignados` });
    else if (s.low) items.push({ sev: 'warn', txt: `Pool de números bajo: quedan ${s.available}`, sub: '' });
  } catch (e) { log.warn(`digest pool: ${e.message}`); }

  // 3) Config del servidor (solo lo grave)
  const missing = [];
  if (!_has('SUPABASE_URL') || !_has('SUPABASE_SERVICE_KEY')) missing.push('Base de datos');
  if (!_has('STRIPE_SECRET_KEY')) missing.push('Stripe');
  if (!_has('RESEND_API_KEY')) missing.push('Email (Resend)');
  if (!_has('DEEPGRAM_API_KEY') || !_has('OPENAI_API_KEY')) missing.push('Voz (STT/LLM)');
  if (missing.length) items.push({ sev: 'crit', txt: 'Config del servidor incompleta: ' + missing.join(', '), sub: '' });

  // 4) Calidad del número de WhatsApp (Meta puede limitar el volumen)
  try {
    const q = deps.waQuality !== undefined ? deps.waQuality : await _waQuality();
    if (q && q !== 'GREEN') items.push({ sev: q === 'RED' ? 'crit' : 'warn', txt: `Calidad del número de WhatsApp: ${q}`, sub: 'Meta puede limitar el volumen de envío' });
  } catch (_) {}

  // 5) INTEGRIDAD DE LOS DATOS DE LLAMADA (PILOT-001/F7)
  // Hasta ahora nadie vigilaba si una llamada se perdía o quedaba a medias: la
  // única señal era un log.warn que no lee nadie. Estas tres señales delatan
  // pérdida de datos (y de dinero) en 24h.
  try {
    const items2 = await callIntegrityItems(db);
    for (const it of items2) items.push(it);
  } catch (e) { log.warn(`digest integridad: ${e.message}`); }

  return items;
}

/**
 * Señales de integridad de `nf_calls` en las últimas 24h. Solo lectura, y
 * fail-open: si la consulta falla, el digest sigue con el resto de avisos.
 *  · huérfanas   → el proceso murió sin cerrar la llamada (o el reap no corre)
 *  · sin dueño   → la fila existe pero NINGÚN panel del cliente la muestra
 *  · sin cerrar  → 'ended' sin outcome: cierre a medias, KPIs y embudo mienten
 */
const HUERFANA_HORAS = 3;   // reaper: 90 min de antigüedad + tick horario → 3h
const LIMITE_FILAS   = 2000;

async function callIntegrityItems(db) {
  const out = [];
  const ahora = Date.now();
  const since = new Date(ahora - 24 * 3600 * 1000).toISOString();
  // D6: `.order()` explícito — sin él PostgREST devuelve filas ARBITRARIAS al
  // truncar, y los contadores salían mal sin avisar. Con orden + aviso de tope,
  // el resultado es determinista y el truncamiento es visible.
  const { data } = await db.client.from('nf_calls')
    .select('id, status, org_id, outcome, started_at, duration_ms')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(LIMITE_FILAS);
  const rows = data || [];
  if (!rows.length) return out;

  // D8: comparar INSTANTES, no cadenas. `started_at` llega con offset
  // (`+00:00`) y el corte era un `toISOString()` (`.000Z`): al compararse como
  // texto, el mismo instante ordenaba distinto y el borde daba falsos positivos.
  // D7: el umbral debe superar la ventana del reaper (90 min + tick horario),
  // o el digest grita por huérfanas que el sistema ya está limpiando solo.
  const corte = ahora - HUERFANA_HORAS * 3600 * 1000;
  const esVieja = (r) => { const t = Date.parse(r.started_at); return Number.isFinite(t) && t < corte; };

  const huerfanas  = rows.filter(r => r.status === 'active' && esVieja(r)).length;
  // A7.1 — LA señal que faltaba: `lost` es lo que escribe la limpieza automática
  // cuando una llamada murió sin cerrarse. Es decir, es la PRUEBA de que un
  // despliegue o una caída se llevó llamadas por delante… y el vigilante solo
  // miraba 'active' y 'ended', así que era ciego justo a eso.
  const perdidas   = rows.filter(r => r.status === 'lost').length;
  // A7.4 — solo cuentan las TERMINADAS: una llamada en curso puede no tener
  // org_id todavía de forma legítima (demo del navegador, "Llámame", salientes
  // de campaña: números que no están en el pool). Contarlas despertaba al
  // fundador por llamadas perfectamente sanas.
  const sinDuenyo  = rows.filter(r => r.status !== 'active' && !r.org_id).length;
  const sinCerrar  = rows.filter(r => r.status === 'ended' && !r.outcome).length;
  const imposibles = rows.filter(r => Number(r.duration_ms) > 3600000 || Number(r.duration_ms) < 0).length;

  if (huerfanas) out.push({ sev: 'crit', txt: `${huerfanas} llamada(s) colgada(s) sin cerrar (>${HUERFANA_HORAS}h)`, sub: 'el proceso murió sin persistir, o la limpieza automática no está corriendo' });
  if (perdidas)  out.push({ sev: 'crit', txt: `${perdidas} llamada(s) marcadas como PERDIDAS`, sub: 'murieron sin cerrarse (deploy/caída): sin transcript, sin resultado y sin minutos' });
  if (sinDuenyo) out.push({ sev: 'crit', txt: `${sinDuenyo} llamada(s) terminadas sin negocio asignado`, sub: 'existen en BD pero NINGÚN panel de cliente las muestra' });
  if (sinCerrar) out.push({ sev: 'warn', txt: `${sinCerrar} llamada(s) cerradas sin resultado`, sub: 'cierre a medias: el embudo y los KPIs las ignoran' });
  if (imposibles) out.push({ sev: 'warn', txt: `${imposibles} llamada(s) con duración imposible`, sub: 'contaminan ROI, salud del cliente y minutos' });
  // El truncamiento no puede ser silencioso: si se alcanza el tope, los
  // contadores de arriba miran solo una parte del día.
  if (rows.length >= LIMITE_FILAS) out.push({ sev: 'warn', txt: `Revisión de integridad truncada a ${LIMITE_FILAS} llamadas/24h`, sub: 'los contadores anteriores cubren solo las más recientes' });
  return out;
}

/**
 * Ejecuta el digest: si hay avisos, email al fundador. Fail-open.
 * @returns {Promise<{sent:boolean, items:number, reason?:string}>}
 */
async function runFounderDigest(deps = {}) {
  if (process.env.FOUNDER_DIGEST_DISABLED === 'true') return { sent: false, items: 0, reason: 'disabled' };
  const founderEmail = deps.founderEmail || process.env.NOTIFY_EMAIL;
  if (!founderEmail) return { sent: false, items: 0, reason: 'no_email' };

  const items = await collectDigestItems(deps);
  if (!items.length) { log.info('Digest matinal: todo en orden — no se envía'); return { sent: false, items: 0, reason: 'all_ok' }; }

  const crit = items.filter(i => i.sev === 'crit').length;
  const dot = s => s === 'crit' ? '🔴' : '🟡';
  const rows = items.map(i =>
    `<tr><td style="padding:8px 10px;font-size:15px">${dot(i.sev)}</td>
     <td style="padding:8px 0;font-size:14px;color:#222"><strong>${i.txt}</strong>${i.sub ? `<br><span style="color:#888;font-size:12px">${i.sub}</span>` : ''}</td></tr>`).join('');
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px">⚡ Buenos días — ${items.length} tema(s) necesitan tu atención</h2>
      <p style="color:#888;margin:0 0 16px">${crit} crítico(s). Cada uno se arregla desde el panel.</p>
      <table style="border-collapse:collapse;width:100%">${rows}</table>
      <p style="margin:22px 0 0"><a href="${process.env.PUBLIC_URL || 'https://nodeflow.es'}/admin" style="background:#c4f546;color:#243100;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:800">Abrir el panel →</a></p>
    </div>`;
  const text = `Digest NodeFlow: ${items.length} tema(s) (${crit} críticos). ` + items.map(i => `${i.txt}${i.sub ? ' (' + i.sub + ')' : ''}`).join(' | ');

  if (deps.dryRun) return { sent: false, items: items.length, reason: 'dry_run' };
  try {
    const sendEmail = deps.sendEmail || require('../notifications/email').sendEmail;
    const ok = await sendEmail({ to: founderEmail, subject: `⚡ ${items.length} tema(s) necesitan tu atención${crit ? ` (${crit} críticos)` : ''} — NodeFlow`, html, text });
    if (ok) log.info(`Digest matinal enviado → ${founderEmail} (${items.length} avisos)`);
    return { sent: !!ok, items: items.length };
  } catch (e) {
    log.warn(`Digest matinal no enviado: ${e.message}`);
    return { sent: false, items: items.length, reason: e.message };
  }
}

// ── Cron: cada día 08:00 Madrid (antes del email de salud de las 09:30) ──────
let _interval = null, _lastRun = null;
function startFounderDigestCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    if (!require('../utils/leader').isLeader()) return; // multi-réplica: solo el líder
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date()).map(p => [p.type, p.value]));
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (`${parts.hour}:${parts.minute}` === '08:00' && _lastRun !== today) {
      _lastRun = today;
      runFounderDigest().catch(e => log.error(`founder-digest cron: ${e.message}`));
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Founder-digest cron iniciado — cada día 08:00 Madrid');
}
function stopFounderDigestCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = { collectDigestItems, callIntegrityItems, runFounderDigest, startFounderDigestCron, stopFounderDigestCron };
