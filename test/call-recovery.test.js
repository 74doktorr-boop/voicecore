// ============================================================
// NodeFlow — Tests de recuperación por llamada (Experimento 01)
// Fija el contrato del número de cabecera del extracto "Lo que recuperé
// por ti": SOLO cuenta como atribución fuerte lo que el negocio habría
// perdido (fuera de horario o en saturación). Conservador a propósito:
// el número tiene que ser indiscutible ante el propio dueño.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  madridParts, hhmmToMin, isAfterHours, callInterval, detectConcurrent,
  appointmentValue, classifyCall, summarizeRecovery, computeRecovery,
  getCallRecovery,
} = require('../src/lifecycle/call-recovery');

// Horario: L-V 09:00-14:00 y 15:30-19:30 (índices numéricos de scheduler).
const SCHEDULE = {
  1: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  2: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  3: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  4: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  5: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
};

// Helpers: horas de Madrid → ISO UTC. En julio, Madrid = UTC+2 (CEST).
// Lunes 2026-07-06. Restamos 2h para obtener el UTC equivalente.
const madridISO = (dateY_M_D, hh, mm) => {
  const [Y, M, D] = dateY_M_D.split('-').map(Number);
  return new Date(Date.UTC(Y, M - 1, D, hh - 2, mm, 0)).toISOString();
};

describe('madridParts / hhmmToMin', () => {
  test('convierte a hora local de Madrid (CEST en julio)', () => {
    const p = madridParts(madridISO('2026-07-06', 11, 30)); // lunes 11:30
    assert.strictEqual(p.dow, 1);        // lunes
    assert.strictEqual(p.minutes, 11 * 60 + 30);
  });
  test('null ante fecha inválida', () => {
    assert.strictEqual(madridParts('no-es-fecha'), null);
  });
  test('hhmmToMin', () => {
    assert.strictEqual(hhmmToMin('09:00'), 540);
    assert.strictEqual(hhmmToMin('24:00'), 1440);
    assert.strictEqual(hhmmToMin('malo'), null);
  });
});

describe('isAfterHours', () => {
  test('dentro de la mañana → false', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-06', 11, 0), SCHEDULE), false);
  });
  test('en la pausa de comida (14:00-15:30) → true', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-06', 14, 45), SCHEDULE), true);
  });
  test('de madrugada → true', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-06', 3, 20), SCHEDULE), true);
  });
  test('justo al cierre (19:30) es exclusivo → true', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-06', 19, 30), SCHEDULE), true);
  });
  test('justo a la apertura (09:00) es inclusivo → false', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-06', 9, 0), SCHEDULE), false);
  });
  test('domingo (día no configurado) → true a cualquier hora', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-05', 11, 0), SCHEDULE), true);
  });
  test('sin horario → null (no se puede saber)', () => {
    assert.strictEqual(isAfterHours(madridISO('2026-07-06', 11, 0), null), null);
  });
});

describe('callInterval / detectConcurrent', () => {
  test('estima fin con duration_ms cuando falta ended_at', () => {
    const box = callInterval({ started_at: '2026-07-06T09:00:00Z', duration_ms: 60000 });
    assert.strictEqual(box[1] - box[0], 60000);
  });
  test('usa duración nominal si no hay ended_at ni duration_ms', () => {
    const box = callInterval({ started_at: '2026-07-06T09:00:00Z' });
    assert.strictEqual(box[1] - box[0], 180000);
  });
  test('detecta el par que solapa y deja fuera al que no', () => {
    const calls = [
      { id: 'a', started_at: '2026-07-06T09:00:00Z', ended_at: '2026-07-06T09:05:00Z' },
      { id: 'b', started_at: '2026-07-06T09:03:00Z', ended_at: '2026-07-06T09:08:00Z' }, // solapa con a
      { id: 'c', started_at: '2026-07-06T12:00:00Z', ended_at: '2026-07-06T12:04:00Z' }, // sola
    ];
    const set = detectConcurrent(calls);
    assert.ok(set.has('a') && set.has('b'));
    assert.ok(!set.has('c'));
  });
  test('llamadas que se tocan justo en el borde NO solapan', () => {
    const calls = [
      { id: 'a', started_at: '2026-07-06T09:00:00Z', ended_at: '2026-07-06T09:05:00Z' },
      { id: 'b', started_at: '2026-07-06T09:05:00Z', ended_at: '2026-07-06T09:10:00Z' },
    ];
    assert.strictEqual(detectConcurrent(calls).size, 0);
  });
});

describe('appointmentValue', () => {
  test('precio real de un objeto', () => {
    assert.strictEqual(appointmentValue({ price: 120 }), 120);
  });
  test('suma un array de reservas', () => {
    assert.strictEqual(appointmentValue([{ price: 120 }, { price: 60 }]), 180);
  });
  test('cae al ticket medio cuando el precio falta o es 0', () => {
    assert.strictEqual(appointmentValue({ price: 0 }, 45), 45);
    assert.strictEqual(appointmentValue({}, 45), 45);
  });
  test('sin reserva → 0', () => {
    assert.strictEqual(appointmentValue(null), 0);
  });
});

describe('classifyCall', () => {
  const ctx = { schedule: SCHEDULE, concurrentIds: new Set(['sat1']), avgTicket: 50 };
  test('sin reserva → null', () => {
    assert.strictEqual(classifyCall({ id: 'x', started_at: madridISO('2026-07-06', 3, 0) }, ctx), null);
  });
  test('reserva fuera de horario → strong / after_hours', () => {
    const r = classifyCall({ id: 'n1', started_at: madridISO('2026-07-06', 22, 0), booked_appointment: { price: 120 } }, ctx);
    assert.strictEqual(r.confidence, 'strong');
    assert.strictEqual(r.type, 'after_hours');
    assert.strictEqual(r.value, 120);
  });
  test('reserva en saturación (concurrente) → strong / concurrent', () => {
    const r = classifyCall({ id: 'sat1', started_at: madridISO('2026-07-06', 11, 0), booked_appointment: { price: 80 } }, ctx);
    assert.strictEqual(r.confidence, 'strong');
    assert.strictEqual(r.type, 'concurrent');
  });
  test('reserva en horario y sin solape → weak (no cuenta en cabecera)', () => {
    const r = classifyCall({ id: 'reg', started_at: madridISO('2026-07-06', 11, 0), booked_appointment: { price: 90 } }, ctx);
    assert.strictEqual(r.confidence, 'weak');
    assert.strictEqual(r.type, 'in_hours_single');
  });
  test('acepta outcome="booked" aunque no venga el objeto', () => {
    const r = classifyCall({ id: 'o1', started_at: madridISO('2026-07-06', 22, 0), outcome: 'booked' }, ctx);
    assert.ok(r);
    assert.strictEqual(r.value, 50); // sin precio → ticket medio
  });
});

describe('computeRecovery — el número de cabecera', () => {
  const calls = [
    // fuera de horario, reserva 120€  → STRONG
    { id: 'c1', started_at: madridISO('2026-07-06', 22, 0), booked_appointment: { price: 120 } },
    // dos simultáneas en horario; la segunda reserva 80€ → STRONG (concurrent)
    { id: 'c2', started_at: madridISO('2026-07-06', 11, 0), ended_at: madridISO('2026-07-06', 11, 5) },
    { id: 'c3', started_at: madridISO('2026-07-06', 11, 3), ended_at: madridISO('2026-07-06', 11, 8), booked_appointment: { price: 80 } },
    // en horario, sin solape, reserva 90€ → WEAK (no cuenta)
    { id: 'c4', started_at: madridISO('2026-07-06', 12, 30), booked_appointment: { price: 90 } },
    // fuera de horario pero SIN reserva → no cuenta
    { id: 'c5', started_at: madridISO('2026-07-06', 23, 0) },
  ];
  const { totals, recoveries } = computeRecovery(calls, { schedule: SCHEDULE, avgTicket: 50 });

  test('cabecera = solo lo que se habría perdido (120 + 80 = 200€)', () => {
    assert.strictEqual(totals.strongCount, 2);
    assert.strictEqual(totals.strongValue, 200);
    assert.strictEqual(totals.afterHours, 1);
    assert.strictEqual(totals.concurrent, 1);
  });
  test('el valor se desglosa por tipo (fuera de horario 120€ / saturación 80€)', () => {
    assert.strictEqual(totals.afterHoursValue, 120);
    assert.strictEqual(totals.concurrentValue, 80);
  });
  test('la reserva en horario cuenta aparte, como weak', () => {
    assert.strictEqual(totals.weakCount, 1);
    assert.strictEqual(totals.weakValue, 90);
  });
  test('devuelve el detalle de cada recuperación', () => {
    assert.strictEqual(recoveries.length, 3); // 2 strong + 1 weak (la sin reserva no aparece)
  });
});

describe('getCallRecovery — cargador con BD falsa', () => {
  function fakeDb(callsRows, orgRow) {
    return {
      enabled: true,
      client: {
        from: (table) => ({
          select: () => ({
            eq: function () { return this; },
            gte: function () { return this; },
            limit: async () => ({ data: callsRows, error: null }),
            single: async () => ({ data: orgRow, error: null }),
          }),
        }),
      },
    };
  }

  test('integra horario + llamadas y devuelve la cifra fuerte', async () => {
    const db = fakeDb(
      [
        { id: 'c1', started_at: madridISO('2026-07-06', 22, 0), booked_appointment: { price: 120 } },
        { id: 'c2', started_at: madridISO('2026-07-06', 11, 0), booked_appointment: { price: 90 } }, // horario, weak
      ],
      { assistant_config: { schedule: { mon: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' } } } },
    );
    const { totals } = await getCallRecovery('org-1', { db, avgTicket: 50 });
    assert.strictEqual(totals.strongCount, 1);
    assert.strictEqual(totals.strongValue, 120);
    assert.strictEqual(totals.weakCount, 1);
  });

  test('fail-soft: BD deshabilitada → totales a cero', async () => {
    const { totals } = await getCallRecovery('org-1', { db: { enabled: false } });
    assert.strictEqual(totals.strongCount, 0);
    assert.strictEqual(totals.strongValue, 0);
  });

  test('fail-soft: un throw de la BD no propaga', async () => {
    const db = { enabled: true, client: { from: () => { throw new Error('boom'); } } };
    const { totals } = await getCallRecovery('org-1', { db });
    assert.strictEqual(totals.strongCount, 0);
  });
});
