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
const { sendWaConfirmation, sendWaReview, sendWaReminder } = require('../src/notifications/reminders');

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

// Auditoría 2026-07-16: confirmación y recordatorio ignoraban no_whatsapp.
describe('opt-out no_whatsapp (confirmación y recordatorio)', () => {
  test('sendWaConfirmation con opt-out → NO envía nada', async () => {
    const deps = fakeDeps(); deps.optedOut = true;
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, false);
    assert.strictEqual(deps.calls.template, null);
  });
  test('sendWaReminder con opt-out → NO envía nada', async () => {
    const deps = fakeDeps(); deps.optedOut = true;
    const ok = await sendWaReminder(APT, CFG, deps);
    assert.strictEqual(ok, false);
    assert.strictEqual(deps.calls.template, null);
  });
  test('sin opt-out (false) → sí envía (no rompe el camino normal)', async () => {
    const deps = fakeDeps(); deps.optedOut = false;
    assert.strictEqual(await sendWaConfirmation(APT, CFG, deps), true);
    const deps2 = fakeDeps(); deps2.optedOut = false;
    assert.strictEqual(await sendWaReminder(APT, CFG, deps2), true);
  });
});

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
    deps.waIsConfigured = () => false; // sin número compartido → no hay red
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, false);
  });

  test('REGLA DE ORO: si el número propio falla, reintenta por el compartido', async () => {
    // El negocio tiene número propio pero su token está roto. El aviso NO se
    // pierde: sale por el número compartido de NodeFlow (credentials=null).
    const deps = fakeDeps();
    const intentos = [];
    deps.sendTemplate = async (phone, name, lang, comp, credentials) => {
      intentos.push(credentials);
      if (credentials) return { ok: false, error: 'invalid access token' }; // propio falla
      return { ok: true, messageId: 'wamid.SHARED' };                        // compartido va
    };
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, true, 'el aviso debe salir por el compartido');
    assert.strictEqual(intentos.length, 2, 'reintenta una vez');
    assert.ok(intentos[0], 'primer intento con credenciales propias');
    assert.strictEqual(intentos[1], null, 'reintento con el número compartido');
  });

  test('no reintenta si NO hay número compartido configurado', async () => {
    const deps = fakeDeps();
    deps.waIsConfigured = () => false;
    let n = 0;
    deps.sendTemplate = async () => { n++; return { ok: false, error: 'x' }; };
    const ok = await sendWaConfirmation(APT, CFG, deps);
    assert.strictEqual(ok, false);
    assert.strictEqual(n, 1, 'sin compartido, no hay reintento');
  });
});

const CFG_REVIEW = { name: 'Peluquería HHR', language: 'es', automations: { config: { reviewUrl: 'https://g.page/r/XYZ/review' } } };

describe('sendWaReview', () => {
  test('plantilla nodeflow_resena aprobada → CONTRATO REAL: 2 params de cuerpo + sufijo g.page en el botón', async () => {
    // La versión aprobada en Meta (verificado 2026-07-13) lleva el enlace como
    // botón URL dinámico https://g.page/r/{{1}} — NO como 3ª variable del cuerpo
    // (eso provocaba el #132000).
    const deps = fakeDeps();
    deps.optedOut = false;
    const ok = await sendWaReview(APT, CFG_REVIEW, deps);
    assert.strictEqual(ok, true);
    assert.strictEqual(deps.calls.template.name, 'nodeflow_resena');
    const body = deps.calls.template.components.find(c => c.type === 'body');
    assert.deepStrictEqual(body.parameters.map(p => p.text), ['Unai', 'Peluquería HHR']);
    const btn = deps.calls.template.components.find(c => c.type === 'button');
    assert.strictEqual(btn.sub_type, 'url');
    assert.deepStrictEqual(btn.parameters.map(p => p.text), ['XYZ/review']); // sufijo tras g.page/r/
  });

  test('sin enlace g.page (placeid o búsqueda) → NO usa la dedicada, va directo a la portadora', async () => {
    const deps = fakeDeps();
    deps.optedOut = false;
    const usados = [];
    deps.sendTemplate = async (phone, name, lang, comp) => { usados.push(name); return { ok: true }; };
    const cfg = { name: 'Peluquería HHR', language: 'es', googlePlaceId: 'PLACE123' }; // sin reviewUrl g.page
    const ok = await sendWaReview(APT, cfg, deps);
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(usados, ['nodeflow_aviso'], 'salta la dedicada (su botón solo admite g.page/r/…)');
  });

  test('nodeflow_resena falla (#132000) → cae a la portadora nodeflow_aviso con el enlace', async () => {
    const deps = fakeDeps();
    deps.optedOut = false;
    const usados = [];
    deps.sendTemplate = async (phone, name, lang, comp, creds) => {
      usados.push(name);
      if (name === 'nodeflow_resena') return { ok: false, error: '(#132000) Number of parameters does not match' };
      return { ok: true, messageId: 'wamid.AVISO' };
    };
    const ok = await sendWaReview(APT, CFG_REVIEW, deps);
    assert.strictEqual(ok, true, 'la reseña sale por la portadora');
    assert.deepStrictEqual(usados, ['nodeflow_resena', 'nodeflow_aviso']);
    // el texto de la portadora lleva el enlace de reseña
    const last = usados.lastIndexOf('nodeflow_aviso');
    assert.ok(last >= 0);
  });

  test('cliente con opt-out (no_whatsapp) → NO se envía reseña por WhatsApp', async () => {
    const deps = fakeDeps();
    deps.optedOut = true;
    const ok = await sendWaReview(APT, CFG_REVIEW, deps);
    assert.strictEqual(ok, false);
    assert.strictEqual(deps.calls.template, null, 'no se llamó a ninguna plantilla');
  });

  test('sin teléfono → no envía', async () => {
    const deps = fakeDeps();
    deps.optedOut = false;
    const ok = await sendWaReview({ ...APT, phone: '' }, CFG_REVIEW, deps);
    assert.strictEqual(ok, false);
  });
});
