// ============================================================
// NodeFlow — el gasto de voz entrante no tenía techo (2026-07-30)
//
// `checkUsageLimits` vivía en UN sitio: /api/calls/outbound. Las entrantes —el
// producto— no pasaban por ningún control. Y el arreglo que proponía la
// auditoría (bajar hardCapMultiplier de 3 a 2) era la respuesta equivocada:
// cortar a quien consume 1.000 min es autolesión SI se le está cobrando.
//
// Lo que decide es quién paga los minutos, no cuántos son.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { voiceSpendStatus, debeRechazarLlamada } = require('../src/billing/voice-spend-guard');

// El plan real de producción (middleware.js PLAN_LIMITS.negocio)
const NEGOCIO = { minutesPerMonth: 500, overage: true, hardCapMultiplier: 3 };

const conSuscripcion = (min) => ({ monthly_minutes_used: min, stripe_subscription_id: 'sub_123' });
const sinSuscripcion = (min) => ({ monthly_minutes_used: min });

describe('voiceSpendStatus — quien paga decide', () => {
  test('cliente que paga y va sobrado: ok', () => {
    const r = voiceSpendStatus(conSuscripcion(120), NEGOCIO);
    assert.strictEqual(r.nivel, 'ok');
    assert.strictEqual(r.loPaga, true);
    assert.strictEqual(r.tope, 1500);
  });

  test('cliente que paga y se pasa: overage, NO se corta', () => {
    // Es el caso que la auditoría proponía cortar bajando el tope a 2×. Sería
    // autolesión: son 0,15 €/min de ingreso y la promesa es "ni una llamada".
    const r = voiceSpendStatus(conSuscripcion(900), NEGOCIO);
    assert.strictEqual(r.nivel, 'overage');
    assert.strictEqual(debeRechazarLlamada(r), false, '900 min facturados no se cortan');
    assert.match(r.motivo, /se facturan/);
  });

  test('cliente que paga y dispara: se marca el tope pero NO se le corta', () => {
    // Su contador se resetea con el webhook invoice.paid. Si ese webhook se
    // pierde una vez, no vuelve a bajar nunca — y colgaríamos las llamadas de
    // un cliente al día por un fallo nuestro. Se avisa y decide un humano.
    const r = voiceSpendStatus(conSuscripcion(1500), NEGOCIO);
    assert.strictEqual(r.nivel, 'tope');
    assert.strictEqual(debeRechazarLlamada(r), false, 'a quien paga no se le cuelga jamás');
    assert.match(r.motivo, /tope de seguridad/);
  });

  test('ni siquiera con un consumo absurdo se corta a quien paga', () => {
    const r = voiceSpendStatus(conSuscripcion(99999), NEGOCIO);
    assert.strictEqual(r.nivel, 'tope');
    assert.strictEqual(debeRechazarLlamada(r), false);
  });

  test('SIN suscripción el techo es estrecho: nadie paga esos minutos', () => {
    // Es el caso de TODAS las orgs de producción hoy: cero suscripciones.
    const r = voiceSpendStatus(sinSuscripcion(700), NEGOCIO);
    assert.strictEqual(r.loPaga, false);
    assert.strictEqual(r.tope, 600, '500 incluidos + 20% de cortesía');
    assert.strictEqual(r.nivel, 'tope');
    assert.match(r.motivo, /nadie paga/);
  });

  test('sin suscripción, dentro de lo incluido, se atiende igual', () => {
    // Un mes de prueba tiene que poder gastar sus 500 minutos.
    const r = voiceSpendStatus(sinSuscripcion(480), NEGOCIO);
    assert.strictEqual(r.nivel, 'ok');
    assert.strictEqual(debeRechazarLlamada(r), false);
  });

  test('sin suscripción, justo pasado, avisa pero no corta (margen de cortesía)', () => {
    const r = voiceSpendStatus(sinSuscripcion(520), NEGOCIO);
    assert.strictEqual(r.nivel, 'overage');
    assert.strictEqual(debeRechazarLlamada(r), false, 'no se corta a nadie por un redondeo');
    assert.match(r.motivo, /no se están cobrando/);
  });

  test('el caso real de hoy: hierros a freixa, 65 min, sin suscripción → ok', () => {
    const r = voiceSpendStatus(sinSuscripcion(65.51), NEGOCIO);
    assert.strictEqual(r.nivel, 'ok');
    assert.strictEqual(r.restantes, 600 - 65.51);
  });
});

describe('voiceSpendStatus — bordes', () => {
  test('plan sin minutos definidos: no inventamos un tope', () => {
    const r = voiceSpendStatus(conSuscripcion(9999), { overage: true });
    assert.strictEqual(r.nivel, 'ok');
    assert.match(r.motivo, /no define minutos/);
  });

  test('plan sin overage: el tope es lo incluido, aunque pague', () => {
    const r = voiceSpendStatus(conSuscripcion(600), { minutesPerMonth: 500, overage: false });
    assert.strictEqual(r.loPaga, false);
    assert.strictEqual(r.nivel, 'tope');
  });

  test('minutos negativos o basura no rompen ni abren la puerta', () => {
    assert.strictEqual(voiceSpendStatus({ monthly_minutes_used: -50 }, NEGOCIO).usados, 0);
    assert.strictEqual(voiceSpendStatus({ monthly_minutes_used: 'x' }, NEGOCIO).nivel, 'ok');
  });

  test('entrada vacía no revienta', () => {
    assert.doesNotThrow(() => voiceSpendStatus());
    assert.doesNotThrow(() => voiceSpendStatus({}, {}));
    assert.strictEqual(debeRechazarLlamada(null), false);
    assert.strictEqual(debeRechazarLlamada(undefined), false);
  });

  test('enterprise no se corta por accidente', () => {
    const ENT = { minutesPerMonth: 99999, overage: true, hardCapMultiplier: 10 };
    assert.strictEqual(voiceSpendStatus(conSuscripcion(50000), ENT).nivel, 'ok');
  });
});
