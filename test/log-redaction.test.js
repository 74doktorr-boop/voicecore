// ============================================================
// NodeFlow — Los logs dejan de llevar datos personales (F7, 2026-07-29)
//
// Los logs van a stdout de EasyPanel y llevaban teléfonos completos de los
// clientes finales de NUESTROS clientes y, en el STT, la transcripción íntegra
// de lo que dice un paciente. Son datos de terceros que nunca contrataron nada
// con NodeFlow, y en sectores sanitarios son categoría especial (art. 9 RGPD).
// El logger no tenía NADA de redacción (79 líneas, cero lógica de máscara).
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { redactPII } = require('../src/utils/logger');

afterEach(() => { delete process.env.LOG_PII; });

describe('redactPII', () => {
  test('enmascara un móvil español en formato E.164', () => {
    const out = redactPII('Call started — +34600111222 → +34843700849');
    assert.ok(!out.includes('600111222'), `sigue el teléfono entero: ${out}`);
    assert.ok(!out.includes('843700849'), `sigue el teléfono entero: ${out}`);
  });

  test('deja pistas suficientes para diagnosticar (prefijo y 2 últimos dígitos)', () => {
    const out = redactPII('cliente +34600111222');
    assert.match(out, /\+346······22/);
  });

  test('enmascara también con espacios y guiones', () => {
    for (const p of ['600 111 222', '600-111-222', '+34 600 111 222']) {
      assert.ok(!redactPII(`tel ${p}`).includes('111222'.slice(0, 4)), `no enmascaró: ${p}`);
    }
  });

  test('NO toca números que no son teléfonos', () => {
    assert.strictEqual(redactPII('TTS completed in 342ms'), 'TTS completed in 342ms');
    assert.strictEqual(redactPII('score 100, turnos 4'), 'score 100, turnos 4');
    assert.strictEqual(redactPII('duration 12345ms'), 'duration 12345ms');
  });

  test('no destroza los identificadores de llamada ni las fechas', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    assert.ok(redactPII(`[${uuid}] ok`).includes('11111111'), 'el callId debe seguir siendo correlacionable');
    assert.ok(redactPII('cita 2026-08-01 a las 10:00').includes('2026-08-01'));
  });

  test('LOG_PII=1 lo desactiva para depurar en local', () => {
    process.env.LOG_PII = '1';
    assert.strictEqual(redactPII('+34600111222'), '+34600111222');
  });

  test('entrada no-string no revienta', () => {
    assert.strictEqual(redactPII(null), 'null');
    assert.strictEqual(redactPII(42), '42');
  });
});
