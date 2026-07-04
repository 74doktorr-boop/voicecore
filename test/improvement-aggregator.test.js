// ============================================================
// NodeFlow — Agregador de mejora continua (opción A, GO de Unai
// 2026-07-04). Carril datos: los info_gap de cada negocio se
// convierten en un aviso accionable a SU dueño. Carril global:
// los problems/improvements de TODAS las llamadas de TODOS los
// negocios se agrupan y, si un patrón se repite, sale como REGLA
// CANDIDATA en el informe al fundador — que aprueba con un OK y
// la regla se implementa con gate (tests+replay) para todos.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { aggregateFindings, runImprovementCycle } = require('../src/lifecycle/improvement-aggregator');

function row(orgId, audit, quality) {
  return { org_id: orgId, started_at: new Date().toISOString(), metrics: { audit, quality: quality || { score: 90 } } };
}

const ROWS = [
  row('org-a', { score: 70, hallucinated: true, info_gap: 'precio del plan',
    problems: ['No dio el precio configurado.'], improvements: ['Dar el precio antes de pedir datos.'] }),
  row('org-a', { score: 80, hallucinated: false, info_gap: 'precio del plan',
    problems: ['Repitió una pregunta.'], improvements: ['Dar el precio antes de pedir datos.'] }),
  row('org-b', { score: 90, hallucinated: false, info_gap: null,
    problems: [], improvements: ['Confirmar antes de colgar.'] }),
  row('org-b', null), // llamada sin auditar
];

describe('aggregateFindings — números y clústeres', () => {
  const agg = aggregateFindings(ROWS);

  test('totales: llamadas, auditadas, media y tasa de alucinación', () => {
    assert.strictEqual(agg.calls, 4);
    assert.strictEqual(agg.audited, 3);
    assert.strictEqual(agg.avgAuditScore, 80); // (70+80+90)/3
    assert.strictEqual(agg.hallucinationRate, 33); // 1 de 3, en %
  });

  test('carril datos: los info_gap se agrupan POR NEGOCIO con contador', () => {
    assert.deepStrictEqual(agg.byOrg['org-a'].infoGaps, [{ gap: 'precio del plan', count: 2, recurrent: false }]);
    assert.deepStrictEqual(agg.byOrg['org-b'].infoGaps, []);
  });

  test('carril global: mejoras repetidas entre llamadas → regla candidata (≥2)', () => {
    assert.strictEqual(agg.candidateRules.length, 1);
    assert.strictEqual(agg.candidateRules[0].count, 2);
    assert.match(agg.candidateRules[0].rule, /Dar el precio antes/);
  });

  test('los problems se agrupan con ejemplo y contador', () => {
    const top = agg.topProblems.find(p => /precio configurado/.test(p.text));
    assert.strictEqual(top.count, 1);
  });

  test('normaliza acentos/mayúsculas al agrupar (no duplica clústeres)', () => {
    const agg2 = aggregateFindings([
      row('o', { score: 50, improvements: ['Confirmar ANTES de colgar'] }),
      row('o', { score: 50, improvements: ['confirmar antes de colgar.'] }),
    ]);
    assert.strictEqual(agg2.candidateRules.length, 1);
    assert.strictEqual(agg2.candidateRules[0].count, 2);
  });

  test('sin filas → estructura vacía sin lanzar', () => {
    const empty = aggregateFindings([]);
    assert.strictEqual(empty.calls, 0);
    assert.deepStrictEqual(empty.candidateRules, []);
  });
});

describe('recurrencia — un hallazgo que sobrevive a la semana anterior es señal de fix fallido', () => {
  const PREV = [
    row('org-a', { score: 60, info_gap: 'precio del plan',
      problems: ['No dio el precio configurado.'], improvements: ['Dar el precio antes de pedir datos.'] }),
  ];

  test('reglas y problemas repetidos entre periodos se marcan recurrent', () => {
    const agg = aggregateFindings(ROWS, PREV);
    const rule = agg.candidateRules[0];
    assert.strictEqual(rule.recurrent, true);
    const prob = agg.topProblems.find(p => /precio configurado/.test(p.text));
    assert.strictEqual(prob.recurrent, true);
    const otro = agg.topProblems.find(p => /Repitió una pregunta/.test(p.text));
    assert.strictEqual(otro.recurrent, false);
  });

  test('los info_gap por negocio también marcan recurrencia', () => {
    const agg = aggregateFindings(ROWS, PREV);
    assert.strictEqual(agg.byOrg['org-a'].infoGaps[0].recurrent, true);
  });

  test('sin periodo anterior, nada es recurrente', () => {
    const agg = aggregateFindings(ROWS);
    assert.strictEqual(agg.candidateRules[0].recurrent, false);
  });
});

describe('runImprovementCycle — el ciclo completo con fakes', () => {
  function fakeDeps(rows) {
    const calls = { ownerMsgs: [], email: null };
    return {
      calls,
      db: {
        enabled: true,
        client: { from: () => ({ select: () => ({ gte: () => ({ not: async () => ({ data: rows, error: null }) }) }) }) },
      },
      notifyOwner: (msg, bizId) => calls.ownerMsgs.push({ msg, bizId }),
      sendEmail: async (opts) => { calls.email = opts; return true; },
      founderEmail: 'unai@nodeflow.es',
    };
  }

  test('avisa a cada dueño con SUS huecos y manda el informe al fundador', async () => {
    const deps = fakeDeps(ROWS);
    const out = await runImprovementCycle(deps);
    assert.strictEqual(out.orgsNotified, 1); // solo org-a tiene gaps
    assert.strictEqual(deps.calls.ownerMsgs.length, 1);
    assert.strictEqual(deps.calls.ownerMsgs[0].bizId, 'org-a');
    assert.match(deps.calls.ownerMsgs[0].msg, /precio del plan/);
    assert.match(deps.calls.ownerMsgs[0].msg, /2 veces/);
    assert.ok(deps.calls.email, 'email al fundador enviado');
    assert.match(deps.calls.email.html, /Dar el precio antes/);
    assert.match(deps.calls.email.html, /apruebas/i); // opción A: pide aprobación
    assert.strictEqual(out.candidateRules, 1);
  });

  test('sin datos → no molesta a nadie', async () => {
    const deps = fakeDeps([]);
    const out = await runImprovementCycle(deps);
    assert.strictEqual(out.orgsNotified, 0);
    assert.strictEqual(deps.calls.ownerMsgs.length, 0);
    assert.strictEqual(deps.calls.email, null);
  });
});

// ── Sector-aware (2026-07-04): reglas candidatas POR VERTICAL ──────────────
describe('aggregateFindings — agrupación POR SECTOR', () => {
  const rowSec = (org, sector, audit) => ({ org_id: org, started_at: new Date().toISOString(), metrics: { audit: { ...audit, sector } } });
  const ROWS_SEC = [
    rowSec('r1', 'restaurante', { score: 60, problems: ['No preguntó comensales.'], improvements: ['Preguntar siempre el número de comensales.'] }),
    rowSec('r2', 'restaurante', { score: 55, problems: ['No preguntó comensales.'], improvements: ['Preguntar siempre el número de comensales.'] }),
    rowSec('d1', 'dental',      { score: 85, problems: [], improvements: ['Preguntar si es primera visita.'] }),
  ];
  const agg = aggregateFindings(ROWS_SEC);

  test('cada sector tiene su bloque con media y reglas propias', () => {
    assert.ok(agg.bySector.restaurante && agg.bySector.dental);
    assert.strictEqual(agg.bySector.restaurante.audited, 2);
    assert.strictEqual(agg.bySector.restaurante.avgScore, 58); // (60+55)/2 ≈ 58
  });

  test('la regla candidata del restaurante NO contamina a dental', () => {
    const rRules = agg.bySector.restaurante.candidateRules.map(r => r.rule);
    assert.ok(rRules.some(r => /comensales/i.test(r)), 'restaurante aprende lo suyo (≥2)');
    const dRules = agg.bySector.dental.candidateRules.map(r => r.rule);
    assert.ok(!dRules.some(r => /comensales/i.test(r)), 'dental no hereda la regla de restaurante');
  });

  test('audits sin sector caen a generico', () => {
    const agg2 = aggregateFindings([{ org_id: 'x', metrics: { audit: { score: 70, problems: [], improvements: [] } } }]);
    assert.ok(agg2.bySector.generico, 'sin sector → generico');
  });
});
