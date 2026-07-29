// ============================================================
// NodeFlow — El profesional de la cita se persiste (A1, auditoría 2026-07-29)
//
// VERIFICADO contra la BD de producción: nf_appointments.staff NO EXISTE.
// Es el mismo fallo que ya se corrigió para `location`, con `staff`, y sin
// detectar. La memoria permite que Ana y Beto compartan el hueco de las 10:00
// (y hay un test que lo consagra), pero:
//   · `staff` no se persistía → tras reiniciar, apt.staff quedaba undefined,
//     _isSlotTaken dejaba de aplicar la excepción por profesional y la agenda
//     de la barbería colapsaba a 1:1 (media capacidad perdida);
//   · el EXCLUDE de la BD no lo conocía → la 2ª cita se rechazaba con 23P01
//     DESPUÉS de que el bot se la confirmó al cliente, y el dueño recibía una
//     alerta de "doble reserva" que era FALSA.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { AppointmentsStore } = require('../src/db/appointments-store');

function fakeClient(results) {
  const rows = [];
  let calls = 0;
  const c = {
    from() {
      return {
        upsert(row) {
          rows.push(row);
          const r = results[Math.min(calls, results.length - 1)];
          calls++;
          return Promise.resolve(r);
        },
      };
    },
  };
  c.calls = () => calls;
  c.rows = rows;
  return c;
}

function makeStore(client) {
  const store = new AppointmentsStore();
  store.init(client);
  store._retryDelayMs = 0;
  const alerts = [];
  store._notify = (msg, org) => { alerts.push({ msg, org }); };
  return { store, alerts };
}

const BASE = { id: 'APT-1', businessId: 'org1', patientName: 'Ana', phone: '+34600111222', date: '2026-08-01', time: '10:00', service: 'Corte' };

describe('A1 — staff en la fila de la BD', () => {
  test('con profesional → se escribe la columna staff', async () => {
    const client = fakeClient([{ error: null }]);
    const { store } = makeStore(client);
    await store.upsert({ ...BASE, staff: 'Beto' });
    assert.strictEqual(client.rows[0].staff, 'Beto');
  });

  test('SIN profesional → la fila NO lleva staff (no rompe donde falte la columna)', async () => {
    const client = fakeClient([{ error: null }]);
    const { store } = makeStore(client);
    await store.upsert(BASE);
    assert.ok(!('staff' in client.rows[0]),
      'escribir staff siempre rompería todos los inserts si la migración no está aplicada');
  });

  test('_fromRow recupera el profesional al rehidratar', () => {
    const store = new AppointmentsStore();
    const apt = store._fromRow({ id: 'APT-1', organization_id: 'org1', patient_name: 'Ana', service: 'Corte', date: '2026-08-01', time: '10:00', staff: 'Beto' });
    assert.strictEqual(apt.staff, 'Beto', 'sin esto, tras un deploy la agenda colapsa a 1:1');
  });

  test('_fromRow con la columna ausente → null, sin romper', () => {
    const store = new AppointmentsStore();
    assert.strictEqual(store._fromRow({ id: 'x', organization_id: 'o' }).staff, null);
  });

  test('patch acepta staff y duration', () => {
    let captured = null;
    const client = { from: () => ({ update: (f) => { captured = f; return { eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'APT-1' }], error: null }) }) }; } }) };
    const { store } = makeStore(client);
    store.patch('APT-1', { staff: 'Ana', duration: 90 });
    assert.strictEqual(captured.staff, 'Ana');
    assert.strictEqual(captured.duration, 90,
      'cambiar de "Corte" (30) a "Coloración" (90) debe reservar el hueco real');
  });
});

describe('A1 — migración sin aplicar: se avisa, pero NO se pierde la cita', () => {
  const MISSING = { error: { code: 'PGRST204', message: "Could not find the 'staff' column of 'nf_appointments' in the schema cache" } };

  test('columna ausente → reintenta SIN staff y la cita se guarda', async () => {
    const client = fakeClient([MISSING, { error: null }]);
    const { store, alerts } = makeStore(client);
    const ok = await store.upsert({ ...BASE, staff: 'Beto' });

    assert.strictEqual(ok, true, 'una migración pendiente no puede costar una cita');
    assert.strictEqual(client.calls(), 2);
    assert.strictEqual(client.rows[0].staff, 'Beto');
    assert.ok(!('staff' in client.rows[1]), 'el reintento va sin la columna');
    assert.strictEqual(alerts.length, 0, 'la cita se guardó: no hay nada que avisar al dueño');
  });

  test('el error 42703 de Postgres se trata igual', async () => {
    const client = fakeClient([{ error: { code: '42703', message: 'column "staff" does not exist' } }, { error: null }]);
    const { store } = makeStore(client);
    assert.strictEqual(await store.upsert({ ...BASE, staff: 'Beto' }), true);
    assert.strictEqual(client.calls(), 2);
  });

  test('NO confunde la falta de OTRA columna con la de staff', () => {
    const store = new AppointmentsStore();
    const otra = { code: 'PGRST204', message: "Could not find the 'location' column" };
    assert.strictEqual(store._isMissingColumn(otra, 'staff'), false);
    assert.strictEqual(store._isMissingColumn(otra, 'location'), true);
  });

  test('NO confunde un error normal con una columna ausente', () => {
    const store = new AppointmentsStore();
    assert.strictEqual(store._isMissingColumn({ code: '23P01', message: 'conflicting key value' }, 'staff'), false);
    assert.strictEqual(store._isMissingColumn({ message: 'network timeout' }, 'staff'), false);
    assert.strictEqual(store._isMissingColumn(null, 'staff'), false);
  });

  test('un fallo de red SIGUE reintentando 3 veces y avisando (no lo rompe el fix)', async () => {
    const client = fakeClient([{ error: { message: 'boom' } }]);
    const { store, alerts } = makeStore(client);
    assert.strictEqual(await store.upsert({ ...BASE, staff: 'Beto' }), false);
    assert.strictEqual(client.calls(), 3);
    assert.strictEqual(alerts.length, 1);
  });
});
