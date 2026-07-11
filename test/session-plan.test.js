// ============================================================
// NodeFlow — Motor del plan por sesiones (Fase 1, 2026-07)
// El dueño captura el RITMO (cada X días) y el sistema calcula solo la
// próxima sesión, las restantes y la caducidad. Test exhaustivo del núcleo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computePlan, markSessionDone, derivedAttrs, reconcilePlanAttrs } = require('../src/entities/session-plan');

describe('computePlan — cálculo del ritmo', () => {
  test('bono nuevo: 10 sesiones cada 30 días desde el 1 de julio', () => {
    const p = computePlan({ totalSessions: 10, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 0, today: '2026-07-01' });
    assert.strictEqual(p.sessionsRemaining, 10);
    assert.strictEqual(p.nextSessionDate, '2026-07-01');  // la 1ª cae el día de inicio
    assert.strictEqual(p.done, false);
  });

  test('con 3 sesiones hechas → próxima = inicio + 3×30, restan 7', () => {
    const p = computePlan({ totalSessions: 10, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 3 });
    assert.strictEqual(p.sessionsRemaining, 7);
    assert.strictEqual(p.nextSessionDate, '2026-09-29'); // +90 días
  });

  test('cadencia semanal (7 días)', () => {
    const p = computePlan({ totalSessions: 5, cadenceDays: 7, startDate: '2026-07-01', sessionsUsed: 2 });
    assert.strictEqual(p.nextSessionDate, '2026-07-15'); // +14
  });

  test('cadencia rara (65 días) — lo que el cliente decida', () => {
    const p = computePlan({ totalSessions: 4, cadenceDays: 65, startDate: '2026-01-10', sessionsUsed: 1 });
    assert.strictEqual(p.nextSessionDate, '2026-03-16'); // +65
  });

  test('bono agotado → done, sin próxima sesión', () => {
    const p = computePlan({ totalSessions: 10, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 10 });
    assert.strictEqual(p.sessionsRemaining, 0);
    assert.strictEqual(p.done, true);
    assert.strictEqual(p.nextSessionDate, null);
  });

  test('sessionsUsed no puede pasar de total (clamp)', () => {
    const p = computePlan({ totalSessions: 5, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 99 });
    assert.strictEqual(p.sessionsUsed, 5);
    assert.strictEqual(p.sessionsRemaining, 0);
    assert.strictEqual(p.done, true);
  });
});

describe('computePlan — caducidad', () => {
  test('validez fija «3 meses» (90 días) → caduca a inicio + 90', () => {
    const p = computePlan({ totalSessions: 5, cadenceDays: 30, startDate: '2026-07-01', validityDays: 90 });
    assert.strictEqual(p.expiryDate, '2026-09-29');
  });

  test('sin validez explícita → caduca tras la última sesión + gracia', () => {
    // última sesión = inicio + (5-1)×30 = +120; gracia 15 → +135
    const p = computePlan({ totalSessions: 5, cadenceDays: 30, startDate: '2026-07-01', graceDays: 15 });
    assert.strictEqual(p.expiryDate, '2026-11-13'); // 2026-07-01 + 135 días
  });

  test('caducado: validez corta y hoy posterior', () => {
    const p = computePlan({ totalSessions: 5, cadenceDays: 30, startDate: '2026-01-01', validityDays: 30, today: '2026-06-01' });
    assert.strictEqual(p.expired, true);
  });

  test('no caducado si hoy es anterior a la caducidad', () => {
    const p = computePlan({ totalSessions: 5, cadenceDays: 30, startDate: '2026-07-01', validityDays: 90, today: '2026-08-01' });
    assert.strictEqual(p.expired, false);
  });
});

describe('computePlan — bordes y datos malos', () => {
  test('sin fecha de inicio → sin próxima ni caducidad, no rompe', () => {
    const p = computePlan({ totalSessions: 10, cadenceDays: 30 });
    assert.strictEqual(p.nextSessionDate, null);
    assert.strictEqual(p.expiryDate, null);
  });

  test('fecha imposible (2026-02-30) → tratada como sin fecha', () => {
    const p = computePlan({ totalSessions: 10, cadenceDays: 30, startDate: '2026-02-30' });
    assert.strictEqual(p.nextSessionDate, null);
  });

  test('total 0 → sin done espurio, sin próxima', () => {
    const p = computePlan({ totalSessions: 0, cadenceDays: 30, startDate: '2026-07-01' });
    assert.strictEqual(p.done, false);
    assert.strictEqual(p.sessionsRemaining, 0);
    assert.strictEqual(p.nextSessionDate, null);
  });

  test('valores string (vienen de inputs del portal) se parsean', () => {
    const p = computePlan({ totalSessions: '10', cadenceDays: '30', startDate: '2026-07-01', sessionsUsed: '3' });
    assert.strictEqual(p.sessionsRemaining, 7);
    assert.strictEqual(p.nextSessionDate, '2026-09-29');
  });
});

describe('markSessionDone — avanzar tras una sesión', () => {
  test('suma una sesión y mueve la próxima', () => {
    const p = markSessionDone({ totalSessions: 10, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 2 });
    assert.strictEqual(p.sessionsUsed, 3);
    assert.strictEqual(p.sessionsRemaining, 7);
    assert.strictEqual(p.nextSessionDate, '2026-09-29');
  });

  test('la última sesión deja el bono agotado', () => {
    const p = markSessionDone({ totalSessions: 3, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 2 });
    assert.strictEqual(p.done, true);
    assert.strictEqual(p.nextSessionDate, null);
  });

  test('no pasa de total al marcar de más', () => {
    const p = markSessionDone({ totalSessions: 3, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 3 });
    assert.strictEqual(p.sessionsUsed, 3);
  });
});

describe('reconcilePlanAttrs — puente con la ficha', () => {
  test('con cadencia: calcula próxima sesión, restantes y caducidad', () => {
    const out = reconcilePlanAttrs({
      motivo: 'lumbar', sesiones_totales: 10, cadencia_dias: 30,
      primera_sesion: '2026-07-01', sesiones_hechas: 3,
    });
    assert.strictEqual(out.sesiones_restantes, 7);
    assert.strictEqual(out.proxima_sesion, '2026-09-29');
    assert.strictEqual(out.caducidad_bono, '2027-04-12'); // última sesión (+270) + gracia 15 = +285
    assert.strictEqual(out.motivo, 'lumbar');             // no toca lo demás
  });

  test('SIN cadencia: respeta las fechas manuales (retrocompatible)', () => {
    const manual = { sesiones_totales: 10, proxima_sesion: '2026-08-15', caducidad_bono: '2026-12-01' };
    const out = reconcilePlanAttrs(manual);
    assert.deepStrictEqual(out, manual);   // no cambia nada
  });

  test('bono agotado: quita la próxima sesión', () => {
    const out = reconcilePlanAttrs({
      sesiones_totales: 3, cadencia_dias: 30, primera_sesion: '2026-07-01', sesiones_hechas: 3,
    });
    assert.strictEqual(out.sesiones_restantes, 0);
    assert.ok(!('proxima_sesion' in out) || out.proxima_sesion == null);
  });

  test('claves inyectables (para otras plantillas, ej. programa)', () => {
    const out = reconcilePlanAttrs(
      { total_s: 5, cada: 7, inicio: '2026-07-01', hechas: 1 },
      { keys: { total: 'total_s', cadence: 'cada', start: 'inicio', used: 'hechas', remaining: 'restan', next: 'prox', expiry: 'cad' } },
    );
    assert.strictEqual(out.restan, 4);
    assert.strictEqual(out.prox, '2026-07-08');
  });
});

describe('derivedAttrs — lo que se guarda en la ficha', () => {
  test('produce los campos derivados para el motor de avisos', () => {
    const a = derivedAttrs({ totalSessions: 10, cadenceDays: 30, startDate: '2026-07-01', sessionsUsed: 3, validityDays: 180 });
    assert.strictEqual(a.sessions_remaining, 7);
    assert.strictEqual(a.next_session, '2026-09-29');
    assert.strictEqual(a.expiry, '2026-12-28');   // +180
    assert.strictEqual(a.plan_done, false);
  });
});
