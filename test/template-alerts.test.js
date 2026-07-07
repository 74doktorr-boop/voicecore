// ============================================================
// NodeFlow — Avisos de estado de plantillas (2026-07-07)
// Meta empuja el estado por webhook; el sistema avisa a Unai al
// instante y le dice qué flag enciende cada aprobación.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildTemplateStatusMessage, handleTemplateStatusUpdate } = require('../src/whatsapp/template-alerts');

describe('buildTemplateStatusMessage', () => {
  test('APPROVED de plantilla que desbloquea feature → incluye el flag exacto', () => {
    const m = buildTemplateStatusMessage({ event: 'APPROVED', message_template_name: 'nodeflow_como_fue_v2', message_template_language: 'es' });
    assert.strictEqual(m.notify, true);
    assert.match(m.text, /APROBADA/);
    assert.match(m.text, /WA_COMO_FUE_BUTTONS=1/);
  });

  test('APPROVED de plantilla normal → aviso sin flag', () => {
    const m = buildTemplateStatusMessage({ event: 'APPROVED', message_template_name: 'nodeflow_promo' });
    assert.strictEqual(m.notify, true);
    assert.doesNotMatch(m.text, /=1/);
  });

  test('REJECTED → incluye el motivo', () => {
    const m = buildTemplateStatusMessage({ event: 'REJECTED', message_template_name: 'nodeflow_aviso', reason: 'INVALID_FORMAT' });
    assert.strictEqual(m.notify, true);
    assert.match(m.text, /RECHAZADA/);
    assert.match(m.text, /INVALID_FORMAT/);
  });

  test('PAUSED/DISABLED → avisa de la limitación', () => {
    const m = buildTemplateStatusMessage({ event: 'PAUSED', message_template_name: 'nodeflow_promo' });
    assert.strictEqual(m.notify, true);
    assert.match(m.text, /limitado|PAUSED/);
  });

  test('PENDING u otros intermedios → sin ruido', () => {
    assert.strictEqual(buildTemplateStatusMessage({ event: 'PENDING', message_template_name: 'x' }).notify, false);
    assert.strictEqual(buildTemplateStatusMessage({}).notify, false);
  });
});

describe('handleTemplateStatusUpdate', () => {
  test('APPROVED → envía WhatsApp + email a Unai', async () => {
    const sent = { wa: 0, email: 0 };
    const r = await handleTemplateStatusUpdate(
      { event: 'APPROVED', message_template_name: 'nodeflow_hueco_libre' },
      { sendWhatsApp: async () => { sent.wa++; }, sendEmail: async () => { sent.email++; } }
    );
    assert.strictEqual(r.notified, true);
    assert.strictEqual(sent.wa, 1);
    assert.strictEqual(sent.email, 1);
  });

  test('PENDING → no molesta', async () => {
    let called = 0;
    const r = await handleTemplateStatusUpdate({ event: 'PENDING' },
      { sendWhatsApp: async () => { called++; }, sendEmail: async () => { called++; } });
    assert.strictEqual(r.notified, false);
    assert.strictEqual(called, 0);
  });

  test('si WhatsApp falla, el email sigue saliendo (y viceversa)', async () => {
    let email = 0;
    const r = await handleTemplateStatusUpdate(
      { event: 'REJECTED', message_template_name: 'x', reason: 'y' },
      { sendWhatsApp: async () => { throw new Error('callmebot caído'); }, sendEmail: async () => { email++; } }
    );
    assert.strictEqual(r.notified, true);
    assert.strictEqual(email, 1);
  });
});
