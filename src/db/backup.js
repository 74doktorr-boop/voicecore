// ============================================================
// NodeFlow — Backup automático de Supabase
// Exporta las tablas críticas a JSON y lo sube a Supabase
// Storage (bucket "backups"). Corre semanalmente (domingo 04:00
// Madrid) + endpoint manual para admin.
//
// Retención: conserva los últimos 8 backups (≈2 meses), borra
// los anteriores automáticamente.
//
// Requisitos: crear el bucket "backups" (privado) en Supabase
// Storage una sola vez — Dashboard → Storage → New bucket.
// ============================================================

'use strict';

const zlib = require('node:zlib');
const { getDatabase } = require('./database');
const { Logger } = require('../utils/logger');

const log = new Logger('BACKUP');

const BUCKET = 'backups';
const KEEP_LAST = 8;

// Tablas críticas — datos de clientes que no se pueden perder.
// (calls y usage se excluyen: son voluminosas y reconstruibles en parte;
//  añadir aquí si se quiere backup completo.)
// dumpTable salta con un warn las tablas que no existan en un despliegue → es
// seguro incluir de más. Faltaban tablas CRÍTICAS: nf_calls (la fuente de verdad
// de llamadas: transcript/auditoría/todo), referidos (dinero), la KB (RAG), los
// sectores custom, tareas, lista de espera, leads, fechas críticas y el uso.
const TABLES = [
  'registros',
  'organizations',
  'assistants',
  'contacts',
  'contact_memory',
  'call_summaries',
  'nf_calls',
  'nf_appointments',
  'nf_tasks',
  'nf_waitlist',
  'nf_callbacks',
  'nf_referrals',
  'nf_referral_conversions',
  'knowledge_chunks',
  'nf_sectors',
  'critical_dates',
  'leads',
  'usage',
  'nf_phone_pool',
  'nf_rebooking_log',
  'whatsapp_accounts',
  'scheduled_reminders',
  'org_reminder_config',
  'org_campaigns',
  'webhook_configs',
  'magic_tokens',
  'demo_bots',
];

const PAGE_SIZE = 1000;

/** Descarga una tabla completa paginando de 1000 en 1000. */
async function dumpTable(db, table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db.client
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      // Tabla inexistente u otro error — registrar y seguir con las demás
      log.warn(`dump ${table}: ${error.message}`);
      return { table, error: error.message, rows: [] };
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { table, count: rows.length, rows };
}

/**
 * Ejecuta un backup completo: dump de todas las tablas → JSON gzip →
 * upload a Supabase Storage. Devuelve resumen { ok, file, tables, bytes }.
 */
async function runBackup() {
  const db = getDatabase();
  if (!db.enabled) return { ok: false, error: 'DB no configurada' };

  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `nodeflow-backup-${stamp}.json.gz`;

  log.info(`Backup iniciado → ${filename}`);

  // 1. Dump de todas las tablas (secuencial — no saturar la API)
  const dumps = [];
  for (const t of TABLES) dumps.push(await dumpTable(db, t));

  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      version: 1,
      tables: dumps.map(d => ({ table: d.table, count: d.count ?? 0, error: d.error || null })),
    },
    data: Object.fromEntries(dumps.map(d => [d.table, d.rows])),
  };

  // 2. Comprimir
  const json = JSON.stringify(payload);
  const gz = zlib.gzipSync(Buffer.from(json, 'utf8'));

  // 3. Subir a Storage
  const { error: upErr } = await db.client.storage
    .from(BUCKET)
    .upload(filename, gz, { contentType: 'application/gzip', upsert: false });

  if (upErr) {
    log.error(`Backup upload falló: ${upErr.message}`);
    return { ok: false, error: upErr.message };
  }

  const totalRows = dumps.reduce((s, d) => s + (d.count || 0), 0);
  log.info(`Backup OK — ${filename} (${(gz.length / 1024).toFixed(1)} KB, ${totalRows} filas, ${Date.now() - startedAt}ms)`);

  // 4. Retención: borrar backups antiguos (fire & forget)
  pruneOldBackups(db).catch(e => log.warn(`Prune error: ${e.message}`));

  return { ok: true, file: filename, bytes: gz.length, rows: totalRows, tables: payload.meta.tables };
}

/** Borra los backups más antiguos, conservando los últimos KEEP_LAST. */
async function pruneOldBackups(db) {
  const { data: files, error } = await db.client.storage.from(BUCKET).list('', { limit: 100 });
  if (error || !files) return;
  const backups = files
    .filter(f => f.name.startsWith('nodeflow-backup-'))
    .sort((a, b) => b.name.localeCompare(a.name)); // más reciente primero
  const toDelete = backups.slice(KEEP_LAST).map(f => f.name);
  if (toDelete.length > 0) {
    await db.client.storage.from(BUCKET).remove(toDelete);
    log.info(`Backups antiguos borrados: ${toDelete.length}`);
  }
}

/** Avisa al fundador si el backup falla — sin esto, un fallo de upload solo iba a
 *  los logs (que nadie vigila) → datos sin respaldo, sin que nadie se entere. */
async function _alertBackupFailure(reason) {
  try {
    const { sendEmail } = require('../notifications/email');
    await sendEmail({
      to: process.env.NOTIFY_EMAIL || 'unai@nodeflow.es',
      subject: '⚠️ El backup semanal de NodeFlow FALLÓ',
      html: `<h2 style="color:#c0392b">El respaldo automático no se completó</h2>
        <p>El backup de la base de datos (domingos 04:00 Madrid) ha fallado:</p>
        <pre style="background:#f5f5f5;padding:10px;border-radius:6px">${String(reason).slice(0, 600)}</pre>
        <p>Revisa el almacenamiento de Supabase y los logs. <b>Sin backups, los datos están en riesgo.</b></p>
        <p style="color:#999;font-size:12px">NodeFlow · aviso automático de infraestructura</p>`,
    });
    log.info('Backup: aviso de fallo enviado al fundador');
  } catch (e) {
    log.error(`Backup: no se pudo avisar del fallo (${e.message})`);
  }
}

// ── Cron: domingo 04:00 Madrid ───────────────────────────────────────────────

let _interval = null;
let _lastRunDate = null; // evita doble ejecución dentro del mismo minuto

function startBackupCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    const now = new Date();
    const madrid = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Madrid',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const parts = Object.fromEntries(madrid.map(p => [p.type, p.value]));
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(now);

    if (parts.weekday === 'Sun' && `${parts.hour}:${parts.minute}` === '04:00' && _lastRunDate !== today) {
      _lastRunDate = today;
      runBackup()
        .then(res => { if (!res || !res.ok) _alertBackupFailure(res && res.error ? res.error : 'resultado no ok'); })
        .catch(e => { log.error(`Backup cron error: ${e.message}`); _alertBackupFailure(e.message); });
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Backup cron iniciado — domingos 04:00 Madrid');
}

function stopBackupCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { runBackup, startBackupCron, stopBackupCron, BACKUP_TABLES: TABLES };
