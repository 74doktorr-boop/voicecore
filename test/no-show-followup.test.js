// ============================================================
// NodeFlow — Plantón → reproposición por WhatsApp (2026-07)
// Al marcar "no vino", se envía al cliente un WhatsApp (nodeflow_aviso)
// ofreciendo reprogramar. Respeta opt-out; fail-open. Deps inyectables.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildNoShowMessage, sendNoShowRebooking } = require('../src/notifications/no-show-followup');

const APT = { id: 'a1', businessId: 'org-1', phone: '+34666111222', patientName: 'Raúl García', service: 'fisioterapia', date: '2026-07-11', time: '09:00' };

describe('buildNoShowMessage', () => {
  test('incluye fecha, hora, servicio y ofrece reprogramar', () => {
    const m = buildNoShowMessage(APT, { humanDate: 'viernes 11 de julio' });
    assert.match(m, /viernes 11 de julio/);
    assert.match(m, /09:00h/);
    assert.match(m, /fisioterapia/);
    assert.match(m, /nuevo hueco|reservo/i);
  });
  test('sin fecha/servicio no rompe', () => {
    const m = buildNoShowMessage({}, {});
    assert.ok(m.length > 10);
  });
});

describe('sendNoShowRebooking', () => {
  function deps(over = {}) {
    const sent = [];
    return {
      sent,
      d: {
        sendTemplate: async (phone, tpl, lang, comps, creds) => { sent.push({ phone, tpl, lang, comps, creds }); return { ok: true, messageId: 'wamid.1' }; },
        isConfigured: () => true,
        getWaCredentials: async () => ({ phoneNumberId: 'pn', accessToken: 'tok' }),
        lookupContact: async () => (over.contact !== undefined ? over.contact : { id: 'c1', no_whatsapp: false }),
        recordLedger: false, // no tocar BD en el test
      },
    };
  }

  test('cliente normal → envía por nodeflow_aviso con nombre/negocio/mensaje', async () => {
    const { sent, d } = deps();
    const r = await sendNoShowRebooking(APT, { name: 'Fisio Unai', language: 'es' }, d);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].tpl, 'nodeflow_aviso');
    const params = sent[0].comps[0].parameters.map(p => p.text);
    assert.strictEqual(params[0], 'Raúl');            // primer nombre
    assert.strictEqual(params[1], 'Fisio Unai');      // negocio
    assert.match(params[2], /no pudiste venir/);      // mensaje
    assert.deepStrictEqual(sent[0].creds, { phoneNumberId: 'pn', accessToken: 'tok' }); // número del negocio
  });

  test('cliente con opt-out (no_whatsapp) → NO envía', async () => {
    const { sent, d } = deps({ contact: { id: 'c1', no_whatsapp: true } });
    const r = await sendNoShowRebooking(APT, {}, d);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'opted_out');
    assert.strictEqual(sent.length, 0);
  });

  test('cita sin teléfono → no envía', async () => {
    const { sent, d } = deps();
    const r = await sendNoShowRebooking({ ...APT, phone: null }, {}, d);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_phone');
    assert.strictEqual(sent.length, 0);
  });

  test('sin WhatsApp configurado (ni credenciales ni global) → no envía', async () => {
    const { sent, d } = deps();
    d.getWaCredentials = async () => null;
    d.isConfigured = () => false;
    const r = await sendNoShowRebooking(APT, {}, d);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_wa');
    assert.strictEqual(sent.length, 0);
  });

  test('contacto no encontrado (null) → igualmente envía (fail-open del opt-out)', async () => {
    const { sent, d } = deps({ contact: null });
    const r = await sendNoShowRebooking(APT, { name: 'X' }, d);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(sent.length, 1);
  });
});
