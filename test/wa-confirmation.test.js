// ============================================================
// NodeFlow — Confirmación por WhatsApp al reservar (petición Unai
// 2026-07-04): cuando un cliente llama y reserva, recibe AL
// INSTANTE la confirmación en WhatsApp desde el número del NEGOCIO
// (multi-tenant), no solo el email. Cierra el ciclo del aviso al
// cliente: confirmación (ahora) → recordatorio día antes (ya) →
// reseña día después (ya).
// Plantilla Meta UTILITY: nodeflow_cita_confirmada
//   {{1}}=nombre {{2}}=negocio {{3}}=fecha {{4}}=hora {{5}}=servicio
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { sendWaConfirmation } = require('../src/notifications/reminders');

function fakeDeps() {
  const calls = { template: null, credsFor: null };
  return {
    calls,
    sendTemplate: async (phone, name, lang, components, credentials) => {
      calls.template = { phone, name, lang, components, credentials };
      return { ok: true, messageId: 'wamid.TEST' };
    },
    getWaCredentials: async (bizId) => { calls.credsFor = bizId; return { phoneNumberId: 'PNI_BIZ', accessToken: 'tok', phoneNumber: '+34843700849' }; },
    waIsConfigured: () => true,
  };
}

const APT = {
  id: 'APT-1', businessId: 'org-1', patientName: 'Unai Sánchez',
  phone: '+34648122803', date: '2026-07-07', time: '13:00', service: 'Corte de pelo',
};
const CFG = { name: 'Peluquería HHR', language: 'es' };

describe('sendWaConfirmation', () => {
  test('envía la plantilla nodeflow_cita_confirmada con los 5 parámetros', async () => {
    const deps = fakeDeps();
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, true);
    assert.strictEqual(deps.calls.template.name, 'nodeflow_cita_confirmada');
    assert.strictEqual(deps.calls.template.lang, 'es');
    const params = deps.calls.template.components[0].parameters.map(p => p.text);
    assert.deepStrictEqual(params, ['Unai', 'Peluquería HHR', 'martes 7 de julio', '13:00', 'Corte de pelo']);
  });

  test('usa las credenciales del NEGOCIO (multi-tenant), no las globales', async () => {
    const deps = fakeDeps();
    await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(deps.calls.credsFor, 'org-1');
    assert.strictEqual(deps.calls.template.credentials.phoneNumberId, 'PNI_BIZ');
  });

  test('cae al número global de NodeFlow si el negocio no tiene WABA propio', async () => {
    const deps = fakeDeps();
    deps.getWaCredentials = async () => null; // negocio sin número propio
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, true);
    assert.strictEqual(deps.calls.template.credentials, null); // sendTemplate usará env globales
  });

  test('sin teléfono del cliente → no envía', async () => {
    const deps = fakeDeps();
    const ok = await sendWaConfirmation({ ...APT, phone: '' }, CFG, deps);
    assert.strictEqual(ok, false);
    assert.strictEqual(deps.calls.template, null);
  });

  test('sin credenciales del negocio Y sin número global → no envía', async () => {
    const deps = fakeDeps();
    deps.getWaCredentials = async () => null;
    deps.waIsConfigured = () => false;
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, false);
    assert.strictEqual(deps.calls.template, null);
  });

  test('euskera → langCode eu y fecha en euskera', async () => {
    const deps = fakeDeps();
    await sendWaConfirmation(APT, { ...CFG, language: 'eu' }, deps);
    assert.strictEqual(deps.calls.template.lang, 'eu');
    // formatDateEu produce nombres de día en euskera (asteartea = martes)
    assert.match(deps.calls.template.components[0].parameters[2].text, /asteartea/);
  });

  test('el envío que falla en Meta devuelve false sin lanzar', async () => {
    const deps = fakeDeps();
    deps.sendTemplate = async () => ({ ok: false, error: 'template not approved' });
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, false);
  });
});
