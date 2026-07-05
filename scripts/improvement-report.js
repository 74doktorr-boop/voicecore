#!/usr/bin/env node
// ============================================================
// NodeFlow — Informe del bucle de mejora (READ-ONLY)
// ------------------------------------------------------------
// Corre el agregador PURO (aggregateFindings) sobre las últimas
// llamadas reales de nf_calls y muestra qué ha aprendido el sistema:
// score medio, alucinación, problemas top y REGLAS CANDIDATAS
// (globales y POR SECTOR). NO envía nada (a diferencia de
// runImprovementCycle, que avisa al dueño por WA y al fundador por
// email). Solo lee.
//
// Uso:  node scripts/improvement-report.js [dias=30]
// ============================================================
'use strict';
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { aggregateFindings } = require('../src/lifecycle/improvement-aggregator');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('❌ Falta SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const days = Math.max(1, parseInt(process.argv[2] || '30', 10));
const sinceMs = Date.now() - days * 86400000;
const since = new Date(sinceMs).toISOString();
const prevSince = new Date(sinceMs - days * 86400000).toISOString();

(async () => {
  const db = createClient(URL, KEY);

  // Ventana actual + ventana anterior (para marcar reglas REINCIDENTES ⟲)
  const [cur, prev] = await Promise.all([
    db.from('nf_calls').select('org_id, metrics, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
    db.from('nf_calls').select('org_id, metrics, created_at').gte('created_at', prevSince).lt('created_at', since).limit(5000),
  ]);
  if (cur.error) { console.error('❌ query nf_calls:', cur.error.message); process.exit(1); }

  const rows = cur.data || [];
  const prevRows = (prev && prev.data) || [];
  const agg = aggregateFindings(rows, prevRows);

  const p = (x) => JSON.stringify(x, null, 2);
  console.log(`\n══ INFORME DEL BUCLE DE MEJORA — últimos ${days} días ══`);
  console.log(`Llamadas: ${agg.calls} · auditadas: ${agg.audited} · score medio: ${agg.avgAuditScore} · alucinación: ${agg.hallucinationRate}`);

  console.log(`\n── PROBLEMAS TOP (global) ──`);
  console.log(agg.topProblems && agg.topProblems.length ? p(agg.topProblems) : '  (ninguno)');

  console.log(`\n── REGLAS CANDIDATAS (global) ──`);
  console.log(agg.candidateRules && agg.candidateRules.length ? p(agg.candidateRules) : '  (ninguna — no hay patrón repetido suficiente)');

  console.log(`\n── POR SECTOR ──`);
  const secs = Object.entries(agg.bySector || {});
  if (!secs.length) { console.log('  (sin sectores estampados — audits viejas caen a genérico; las nuevas traen sector)'); }
  for (const [sec, s] of secs) {
    console.log(`\n  [${sec}] auditadas ${s.audited} · score ${s.avgScore != null ? s.avgScore : '—'}`);
    if (s.candidateRules && s.candidateRules.length) {
      for (const r of s.candidateRules) console.log(`    • ${r.rule}  (${r.count} llamadas${r.recurrent ? ' · ⟲ REINCIDENTE' : ''})`);
    } else console.log('    (sin reglas candidatas)');
  }
  console.log('');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
