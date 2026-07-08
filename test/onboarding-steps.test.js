// ============================================================
// NodeFlow — "Primeros pasos" SMART (2026-07-09)
// El cuadro de bienvenida debe marcar cada paso solo a partir de señales
// reales y desaparecer cuando todos están hechos. Estos tests fijan la
// lógica pura de estado (sin I/O).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  isAssistantConfigured,
  isBusinessDataComplete,
  hasHeardIt,
  isForwardingActive,
  computeOnboardingSteps,
  onboardingSummary,
} = require('../src/lifecycle/onboarding-steps');

describe('Configura tu asistente', () => {
  test('sin sector → pendiente aunque haya servicios', () => {
    assert.strictEqual(isAssistantConfigured({ serviceList: [{ name: 'X' }] }), false);
  });
  test('solo sector (sin servicios/saludo/voz) → pendiente', () => {
    assert.strictEqual(isAssistantConfigured({ sector: 'taller' }), false);
  });
  test('sector + servicios → hecho', () => {
    assert.strictEqual(isAssistantConfigured({ sector: 'taller', serviceList: [{ name: 'Aceite' }] }), true);
  });
  test('sector + saludo personalizado → hecho', () => {
    assert.strictEqual(isAssistantConfigured({ sector: 'taller', welcomeMessage: 'Hola, taller Pepe' }), true);
  });
  test('sector + voz elegida → hecho', () => {
    assert.strictEqual(isAssistantConfigured({ sector: 'taller', voice: 'elevenlabs-fem-1' }), true);
  });
  test('saludo en blanco no cuenta', () => {
    assert.strictEqual(isAssistantConfigured({ sector: 'taller', welcomeMessage: '   ' }), false);
  });
});

describe('Completa los datos del negocio', () => {
  test('vacío → pendiente', () => {
    assert.strictEqual(isBusinessDataComplete({}), false);
  });
  test('solo dirección → hecho', () => {
    assert.strictEqual(isBusinessDataComplete({ address: 'Calle Mayor 1' }), true);
  });
  test('solo horario → hecho', () => {
    assert.strictEqual(isBusinessDataComplete({ schedule: 'L-V 9-18' }), true);
  });
  test('solo teléfono de alertas → hecho', () => {
    assert.strictEqual(isBusinessDataComplete({ alertPhone: '+34600000000' }), true);
  });
});

describe('Escúchalo antes de desviar', () => {
  test('sin llamadas → pendiente', () => {
    assert.strictEqual(hasHeardIt({ totalCalls: 0 }), false);
  });
  test('≥1 llamada (cualquier dirección) → hecho', () => {
    assert.strictEqual(hasHeardIt({ totalCalls: 1 }), true);
  });
});

describe('Activa el desvío de llamadas (solo señal fiable: inbound)', () => {
  test('llamadas pero ninguna entrante → pendiente', () => {
    assert.strictEqual(isForwardingActive({ totalCalls: 3, inboundCalls: 0 }), false);
  });
  test('≥1 llamada entrante → hecho (el desvío funciona)', () => {
    assert.strictEqual(isForwardingActive({ inboundCalls: 1 }), true);
  });
});

describe('computeOnboardingSteps: orden y "pago siempre hecho"', () => {
  test('devuelve 5 pasos con las claves esperadas y paid=true', () => {
    const steps = computeOnboardingSteps({});
    assert.deepStrictEqual(steps.map(s => s.key), ['paid', 'assistant', 'business', 'heard', 'forwarding']);
    assert.strictEqual(steps[0].done, true);
  });
});

describe('onboardingSummary: progreso y allDone → ocultar', () => {
  test('org recién pagada → 1 de 5, no allDone', () => {
    const s = onboardingSummary({});
    assert.strictEqual(s.doneCount, 1);
    assert.strictEqual(s.total, 5);
    assert.strictEqual(s.allDone, false);
  });
  test('todo hecho → 5 de 5, allDone=true (el cuadro se oculta)', () => {
    const s = onboardingSummary({
      sector: 'taller',
      serviceList: [{ name: 'Aceite' }],
      address: 'Calle Mayor 1',
      totalCalls: 4,
      inboundCalls: 2,
    });
    assert.strictEqual(s.doneCount, 5);
    assert.strictEqual(s.allDone, true);
  });
  test('progreso intermedio → 3 de 5, no allDone', () => {
    const s = onboardingSummary({
      sector: 'taller',
      voice: 'v1',            // asistente ✓
      schedule: 'L-V',        // negocio ✓
      totalCalls: 0,          // heard ✗
      inboundCalls: 0,        // forwarding ✗
    });
    assert.strictEqual(s.doneCount, 3);   // paid + assistant + business
    assert.strictEqual(s.allDone, false);
  });
});
