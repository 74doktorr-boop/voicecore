#!/usr/bin/env node
// ============================================================
// NodeFlow — Canary funcional del lanzamiento (2026-07-16)
// Ejercita los caminos CRÍTICOS en vivo (más allá de /health de UptimeRobot):
// salud (db+redis), que las páginas del embudo carguen, y que el CEREBRO del
// demo responda de verdad. Seguro: no crea datos ni gasta apenas (una llamada
// LLM mínima). Sale con código !=0 si algo falla → apto para cron/monitor.
//
//   node scripts/launch-canary.js [baseUrl]     (default https://nodeflow.es)
//
// Uso en lanzamiento: córrelo a mano antes de abrir, o en bucle cada N min
// (cron / task) para saber en tiempo real si el embudo sigue en pie.
// ============================================================
'use strict';

const BASE = (process.argv[2] || process.env.CANARY_BASE_URL || 'https://nodeflow.es').replace(/\/$/, '');
const TIMEOUT_MS = 15000;

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); }

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// 1) Salud: status ok + db + redis conectados.
async function checkHealth() {
  try {
    const r = await fetchWithTimeout(`${BASE}/health`);
    const j = await r.json();
    const ok = r.ok && j.status === 'ok' && j.database === 'connected';
    const redisOk = j.redis === 'connected' || j.redis === undefined; // redis opcional
    record('health', ok && redisOk, `status=${j.status} db=${j.database} redis=${j.redis} assistants=${j.assistants}`);
  } catch (e) { record('health', false, e.message); }
}

// 2) Páginas del embudo cargan (200 + algo de HTML).
async function checkPage(path, mustInclude) {
  try {
    const r = await fetchWithTimeout(`${BASE}${path}`);
    const body = await r.text();
    const ok = r.ok && (!mustInclude || body.includes(mustInclude));
    record(`page ${path}`, ok, `HTTP ${r.status}${mustInclude && !body.includes(mustInclude) ? ` (falta "${mustInclude}")` : ''}`);
  } catch (e) { record(`page ${path}`, false, e.message); }
}

// 3) El cerebro del demo responde (LLM + backend end-to-end).
async function checkDemoBrain() {
  try {
    const r = await fetchWithTimeout(`${BASE}/api/demo/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [
        { role: 'system', content: 'Eres la recepcionista de una clínica. Responde en una frase.' },
        { role: 'user', content: 'Hola, ¿qué horario tenéis?' },
      ] }),
    });
    const j = await r.json().catch(() => ({}));
    const reply = (j && j.reply) || '';
    const ok = r.ok && typeof reply === 'string' && reply.trim().length > 0;
    record('demo brain', ok, ok ? `respondió (${reply.length} chars)` : `HTTP ${r.status} sin reply`);
  } catch (e) { record('demo brain', false, e.message); }
}

(async () => {
  const started = Date.now();
  console.log(`🐤 Canary NodeFlow → ${BASE}`);
  await checkHealth();
  await Promise.all([
    checkPage('/', 'nodeflow'),
    checkPage('/portal/', 'loginScreen'),
    checkPage('/onboarding.html', 'crear tu asistente'),
    checkPage('/demo.html', null),
    checkPage('/gracias/', 'NodeFlow'),
  ]);
  await checkDemoBrain();

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(22)} ${r.detail || ''}`);
  console.log(`\n${failed.length ? '🔴' : '🟢'} ${results.length - failed.length}/${results.length} OK · ${Date.now() - started}ms`);
  if (failed.length) { console.error(`FALLOS: ${failed.map(f => f.name).join(', ')}`); process.exit(1); }
  process.exit(0);
})();
