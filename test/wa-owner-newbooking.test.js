// ============================================================
// NodeFlow — WhatsApp al DUEÑO por reserva nueva (2026-07-19)
// Antes el "Nueva reserva" solo iba a Unai (Callmebot) o por email. Ahora el
// dueño real lo recibe en su WhatsApp (alertPhone) vía plantilla Meta
// nodeflow_nueva_reserva. Fail-open si no hay alertPhone/plantilla.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { sendWaOwnerNewBooking } = require('../src/notifications/reminders');

const APT = { id: 'APT-1', businessId: 'org1', patientName: 'Ana García', service: 'Fisioterapia', date: '2026-07-21', time: '18:00' };

function deps(sent) {
  return {
    sendTemplate: async (to, name, lang, comps) => { sent.push({ to, name, lang, comps }); return { ok: true }; },
    getWaCredentials: async () => ({ phoneNumberId: 'x', accessToken: 'y' }),
    waIsConfigured: () => true,
  };
}

describe('sendWaOwnerNewBooking', () => {
  test('con alertPhone → manda nodeflow_nueva_reserva al dueño con los 4 params', async () => {
    const sent = [];
    const ok = await sendWaOwnerNewBooking(APT, { name: 'Hierros', automations: { config: { alertPhone: '+34 666351319' } } }, deps(sent));
    assert.strictEqual(ok, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, '+34 666351319');
    assert.strictEqual(sent[0].name, 'nodeflow_nueva_reserva');
    const params = sent[0].comps[0].parameters.map(p => p.text);
    assert.deepStrictEqual(params.slice(0, 2), ['Ana García', 'Fisioterapia']);
    assert.strictEqual(params[3], '18:00');
  });

  test('sin alertPhone → no manda nada (false)', async () => {
    const sent = [];
    const ok = await sendWaOwnerNewBooking(APT, { name: 'X', automations: { config: {} } }, deps(sent));
    assert.strictEqual(ok, false);
    assert.strictEqual(sent.length, 0);
  });

  test('fail-open: plantilla aún no aprobada → false, no revienta', async () => {
    const ok = await sendWaOwnerNewBooking(APT, { alertPhone: '+34600' }, {
      sendTemplate: async () => ({ ok: false, error: 'template not approved' }),
      getWaCredentials: async () => null,
      waIsConfigured: () => true,
    });
    assert.strictEqual(ok, false);
  });
});
