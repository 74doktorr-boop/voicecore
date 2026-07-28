// ============================================================
// NodeFlow — Tope de gasto SALIENTE (Fase 3, 2026-07-28)
// Guardarraíl anti factura sorpresa: las llamadas salientes consumen el mismo
// pool de minutos (0,15€/min sobre lo incluido). Un cap mensual por org, fail-
// closed en el dispatcher, evita que una campaña grande se coma el pool en
// silencio (Charter: nada de fallbacks silenciosos que gasten dinero).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { capOf, monthStartISO, DEFAULT_OUTBOUND_CAP, loadCapState } = require('../src/campaigns/dispatcher');

// Mock mínimo del cliente Supabase para loadCapState: la consulta de orgs
// resuelve una org con tope 200; la de conteo de gasto puede resolver o LANZAR.
function mockDb({ throwOnCount = false, count = 5 } = {}) {
  return {
    client: {
      from(table) {
        if (table === 'organizations') {
          return { select: () => ({ in: async () => ({ data: [{ id: 'o1', automation_config: { config: { outboundMonthlyCap: 200 } } }] }) }) };
        }
        return { select: () => ({ eq: () => ({ gte: async () => {
          if (throwOnCount) throw new Error('BD caída');
          return { count };
        } }) }) };
      },
    },
  };
}

describe('capOf — tope efectivo por org', () => {
  test('sin config → default', () => {
    assert.strictEqual(capOf({}), DEFAULT_OUTBOUND_CAP);
    assert.strictEqual(capOf(null), DEFAULT_OUTBOUND_CAP);
  });
  test('config numérica se respeta', () => {
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: 50 } } }), 50);
  });
  test('0 = pausa total (válido, no cae al default)', () => {
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: 0 } } }), 0);
  });
  test('valor inválido → default (no rompe)', () => {
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: 'xx' } } }), DEFAULT_OUTBOUND_CAP);
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: -5 } } }), DEFAULT_OUTBOUND_CAP);
  });
});

describe('monthStartISO — inicio de mes UTC', () => {
  test('devuelve el día 1 a medianoche UTC', () => {
    assert.ok(monthStartISO(Date.UTC(2026, 6, 28, 15, 30)).startsWith('2026-07-01T00:00:00'));
    assert.ok(monthStartISO(Date.UTC(2026, 0, 1, 0, 0)).startsWith('2026-01-01T00:00:00'));
  });
});

describe('gate del dispatcher — fail-closed al alcanzar el tope', () => {
  // Réplica de la decisión del dispatcher: used >= cap → CANCELA (no llama).
  const overCap = (used, cap) => used >= cap;
  test('por debajo del tope → llama', () => {
    assert.strictEqual(overCap(199, 200), false);
  });
  test('en el tope o por encima → cancela (no gasta de más)', () => {
    assert.strictEqual(overCap(200, 200), true);
    assert.strictEqual(overCap(500, 200), true);
  });
  test('cap 0 → cancela cualquier llamada (pausa total)', () => {
    assert.strictEqual(overCap(0, 0), true);
    assert.strictEqual(overCap(3, 0), true);
  });
});

describe('loadCapState — fail-CLOSED cuando no se puede verificar el gasto', () => {
  test('conteo OK → used real, sin marca unknown', async () => {
    const st = await loadCapState(mockDb({ count: 7 }), ['o1']);
    assert.strictEqual(st.o1.used, 7);
    assert.strictEqual(st.o1.cap, 200);
    assert.strictEqual(st.o1.unknown, undefined);
  });
  test('conteo FALLA → unknown:true (NO used=0 silencioso que dejaría pasar todo)', async () => {
    const st = await loadCapState(mockDb({ throwOnCount: true }), ['o1']);
    assert.strictEqual(st.o1.unknown, true);
  });
  test('decisión del dispatcher: unknown → POSPONE; tope € → POSPONE; nº de llamadas → CANCELA', () => {
    // Réplica del orden de tick(): unknown y tope-€ posponen (continue); el tope
    // por nº de llamadas cancela; si no, llama.
    const decide = (cs, euroCapped) => (cs && cs.unknown) ? 'defer'
      : euroCapped ? 'defer'
      : (cs && cs.used >= cs.cap) ? 'cancel' : 'call';
    assert.strictEqual(decide({ cap: 200, used: 0, unknown: true }, false), 'defer');
    assert.strictEqual(decide({ cap: 200, used: 5 }, true),  'defer');  // sobre el tope € aunque el nº no llegue
    assert.strictEqual(decide({ cap: 200, used: 5 }, false), 'call');
    assert.strictEqual(decide({ cap: 200, used: 200 }, false), 'cancel');
  });
});
