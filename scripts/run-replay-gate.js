// ============================================================
// NodeFlow — Ejecuta el replay gate contra llamadas REALES.
// Uso: node scripts/run-replay-gate.js [nLlamadas=10] [tolerancia=5]
//
// Re-juega las últimas N llamadas auditadas de nf_calls contra el
// prompt generado por el CÓDIGO ACTUAL (la regla candidata debe
// estar ya aplicada en prompt-generator, en local, SIN desplegar).
// Verde = la regla no empeora las llamadas reales → commit+deploy.
// ============================================================
'use strict';
require('dotenv').config();

const N = parseInt(process.argv[2], 10) || 10;
const TOL = parseInt(process.argv[3], 10) || 5;

(async () => {
  const { getDatabase } = require('../src/db/database');
  const { generatePrompt } = require('../src/assistants/prompt-generator');
  const { runReplayGate } = require('../src/lifecycle/replay-gate');

  const db = getDatabase();
  if (!db.enabled) { console.error('Sin BD'); process.exit(1); }

  // Últimas N llamadas con transcript y auditoría
  const { data: rows, error } = await db.client
    .from('nf_calls')
    .select('id, org_id, transcript, metrics')
    .not('metrics', 'is', null)
    .order('started_at', { ascending: false })
    .limit(N * 3);
  if (error) { console.error(error.message); process.exit(1); }

  const calls = (rows || [])
    .filter(r => Array.isArray(r.transcript) && r.transcript.length >= 2 && r.metrics?.audit?.score != null)
    .slice(0, N);
  if (!calls.length) { console.error('No hay llamadas auditadas que re-jugar'); process.exit(1); }

  // Prompt candidato por org (config real de BD + código ACTUAL)
  const orgIds = [...new Set(calls.map(c => c.org_id).filter(Boolean))];
  const { data: orgs } = await db.client
    .from('organizations').select('id, name, assistant_config, automation_config').in('id', orgIds);
  const orgMap = new Map((orgs || []).map(o => [o.id, o]));

  const enriched = calls.map(c => {
    const org = orgMap.get(c.org_id);
    const cfg = { ...(org?.assistant_config || {}) };
    const sl = org?.automation_config?.config?.serviceList;
    if (Array.isArray(sl) && sl.length) cfg.serviceList = sl;
    return {
      id: c.id,
      transcript: c.transcript,
      assistantMode: cfg.mode === 'contacto' ? 'contacto' : 'citas',
      serviceList: cfg.serviceList || null,
      metrics: c.metrics,
      _prompt: generatePrompt(cfg, org?.name || 'Negocio'),
    };
  });

  console.log(`Replay gate: ${enriched.length} llamadas, tolerancia ${TOL}…`);
  // El gate corre por-llamada con el prompt de SU org (multi-tenant)
  let origSum = 0, repSum = 0, n = 0;
  const details = [];
  for (const call of enriched) {
    const out = await runReplayGate({ candidatePrompt: call._prompt, calls: [call], tolerance: TOL });
    if (out.replayed === 1) {
      origSum += out.originalAvg; repSum += out.replayAvg; n++;
      details.push(out.details[0]);
      console.log(`  ${call.id.slice(0, 8)}: original ${out.originalAvg} → replay ${out.replayAvg}`);
    }
  }
  if (!n) { console.error('Nada re-jugado'); process.exit(1); }
  const { gateVerdict } = require('../src/lifecycle/replay-gate');
  const final = gateVerdict(Math.round(origSum / n), Math.round(repSum / n), TOL);
  console.log(`\n${final.pass ? '✅ PASA' : '❌ NO PASA'} — ${final.reason}`);
  process.exit(final.pass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
