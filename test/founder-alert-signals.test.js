// ============================================================
// NodeFlow — shouldAlert: señales DETERMINISTAS de fallo (fix 2026-07)
// Bug real: una llamada de fisioterapia unai salió fatal (el bot repitió
// "no te he escuchado" y acabó tomando recado) y NO llegó alerta al
// fundador, porque shouldAlert solo miraba el auditor IA (score<60,
// alucinación, insatisfecho) e IGNORABA las señales deterministas que
// SÍ estaban en las métricas: escalatedTakeMessage, recoveries,
// clarifications. Este test fija que esos fallos SIEMPRE alertan, en
// todos los sectores, sin depender de que el auditor IA los pille.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { shouldAlert } = require('../src/notifications/founder-alert');

const goodAudit = { score: 85, hallucinated: false, customer_satisfied: true };

describe('shouldAlert — señales deterministas', () => {
  test('llamada buena → no alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: {} }, goodAudit), false);
  });

  test('el bot se rindió y tomó recado (escalatedTakeMessage) → alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: { escalatedTakeMessage: true } }, goodAudit), true);
  });

  test('>=2 turnos vacíos "no te he escuchado" (recoveries) → alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: { recoveries: 2 } }, goodAudit), true);
    assert.strictEqual(shouldAlert({ metrics: { recoveries: 1 } }, goodAudit), false);
  });

  test('>=3 peticiones de repetición (clarifications) → alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: { clarifications: 3 } }, goodAudit), true);
    assert.strictEqual(shouldAlert({ metrics: { clarifications: 2 } }, goodAudit), false);
  });

  test('sigue alertando por score bajo / alucinación / insatisfecho', () => {
    assert.strictEqual(shouldAlert({ metrics: {} }, { score: 50 }), true);
    assert.strictEqual(shouldAlert({ metrics: {} }, { score: 90, hallucinated: true }), true);
    assert.strictEqual(shouldAlert({ metrics: {} }, { score: 90, customer_satisfied: false }), true);
  });

  test('score determinista bajo → alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: { quality: { score: 40 } } }, goodAudit), true);
  });

  test('LA llamada real fallida habría alertado (recoveries=3 + escalated, aunque el auditor la puntuara 65)', () => {
    const callData = { metrics: { recoveries: 3, escalatedTakeMessage: true, clarifications: 1 } };
    assert.strictEqual(shouldAlert(callData, { score: 65, customer_satisfied: true }), true);
  });

  test('no lanza sin metrics ni audit', () => {
    assert.strictEqual(shouldAlert({}, null), false);
    assert.strictEqual(shouldAlert(null, null), false);
  });
});
