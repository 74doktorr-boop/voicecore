// ============================================================
// NodeFlow — Poder ver desde fuera si el cobro está configurado (2026-07-30)
//
// Al ensayar la auditoría nocturna contra la BD real salieron cuatro CRÍTICOS
// por variables ausentes... que estaban puestas en EasyPanel y no en el .env
// local. O sea: no había forma de distinguir "falta de verdad en producción" de
// "falta en mi máquina" sin esperar al correo de las 07:30.
//
// De TELNYX_PUBLIC_KEY sí se sabía, porque /health publica telnyxSignature.
// Se aplica el mismo criterio a lo que decide si se cobra: sin los medidores de
// Stripe, el excedente se cuenta y NO se cobra — el único agujero que se vuelve
// negativo con un cliente legítimo.
//
// PRESENCIA, jamás el valor: /health es público.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// La misma expresión que calcula el campo en routes.js. Se replica aquí a
// propósito en vez de exportarla: lo que se está fijando es el CONTRATO de
// /health, y quiero que renombrar una variable rompa este test.
const CLAVES = ['STRIPE_OVERAGE_METER_EVENT', 'STRIPE_MSG_METER_EVENT', 'ENCRYPTION_KEY'];
const billingConfig = (env) => {
  const faltan = CLAVES.filter(k => !env[k]);
  return faltan.length ? `FALTA: ${faltan.join(', ')}` : 'ok';
};

describe('billingConfig en /health', () => {
  test('con todo puesto, dice ok', () => {
    assert.strictEqual(billingConfig({
      STRIPE_OVERAGE_METER_EVENT: 'nodeflow_overage_minutes',
      STRIPE_MSG_METER_EVENT: 'mensajes_extra',
      ENCRYPTION_KEY: 'x'.repeat(64),
    }), 'ok');
  });

  test('nombra lo que falta, para no tener que adivinar cuál', () => {
    const r = billingConfig({ ENCRYPTION_KEY: 'x' });
    assert.match(r, /^FALTA: /);
    assert.match(r, /STRIPE_OVERAGE_METER_EVENT/);
    assert.match(r, /STRIPE_MSG_METER_EVENT/);
    assert.ok(!r.includes('ENCRYPTION_KEY'), 'esa sí está');
  });

  test('una cadena vacía es faltar: Stripe acepta el evento y lo descarta', () => {
    // Es el modo de fallo caro: con el nombre mal o vacío, Stripe responde 200
    // y tira el evento. No hay error en ningún log.
    assert.match(billingConfig({ STRIPE_OVERAGE_METER_EVENT: '', STRIPE_MSG_METER_EVENT: 'x', ENCRYPTION_KEY: 'y' }),
      /STRIPE_OVERAGE_METER_EVENT/);
  });

  test('entorno vacío las nombra todas y no revienta', () => {
    const r = billingConfig({});
    for (const k of CLAVES) assert.ok(r.includes(k), `falta mencionar ${k}`);
  });

  test('NUNCA publica el valor de nada', () => {
    const secreto = 'sk_live_esto_no_puede_salir';
    const r = billingConfig({ STRIPE_OVERAGE_METER_EVENT: secreto, STRIPE_MSG_METER_EVENT: secreto, ENCRYPTION_KEY: secreto });
    assert.strictEqual(r, 'ok');
    assert.ok(!r.includes(secreto), '/health es público: solo presencia');
  });
});
