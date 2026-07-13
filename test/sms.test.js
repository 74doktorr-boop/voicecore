// ============================================================
// NodeFlow — Canal SMS (Telnyx). Verifica el gating (OFF por defecto),
// la normalización E.164, el requisito de messaging_profile con sender
// alfanumérico, y que sendSMS es fail-open (no lanza) e inerte sin config.
// Sin red: fetch inyectado.
// ============================================================
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { sendSMS, isConfigured, _isAlphanumericSender } = require('../src/notifications/sms');

const SNAP = { ...process.env };
function reset() {
  for (const k of ['SMS_ENABLED', 'TELNYX_API_KEY', 'SMS_FROM', 'SMS_MESSAGING_PROFILE_ID']) delete process.env[k];
}
beforeEach(reset);
afterEach(() => { reset(); Object.assign(process.env, SNAP); });

describe('SMS gating (isConfigured)', () => {
  test('OFF por defecto (sin nada)', () => {
    assert.equal(isConfigured(), false);
  });

  test('OFF aunque haya credenciales si SMS_ENABLED != true', () => {
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = '+34843000000';
    assert.equal(isConfigured(), false);
  });

  test('ON con número + api key + SMS_ENABLED', () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = '+34843000000';
    assert.equal(isConfigured(), true);
  });

  test('sender alfanumérico SIN messaging profile → OFF (Telnyx lo rechazaría)', () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = 'NodeFlow';
    assert.equal(isConfigured(), false);
  });

  test('sender alfanumérico CON messaging profile → ON', () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = 'NodeFlow';
    process.env.SMS_MESSAGING_PROFILE_ID = 'mp_1';
    assert.equal(isConfigured(), true);
  });
});

describe('_isAlphanumericSender', () => {
  test('detecta letras', () => {
    assert.equal(_isAlphanumericSender('NodeFlow'), true);
    assert.equal(_isAlphanumericSender('+34843000000'), false);
    assert.equal(_isAlphanumericSender(''), false);
  });
});

describe('sendSMS', () => {
  test('no-op inmediato si el canal no está activo (no llama a fetch)', async () => {
    let called = false;
    const r = await sendSMS('666351319', 'hola', { fetch: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_configured');
    assert.equal(called, false);
  });

  test('envía por Telnyx con destino normalizado a E.164', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = '+34843000000';
    let captured = null;
    const fakeFetch = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
      return { ok: true, json: async () => ({ data: { id: 'msg_1' } }) };
    };
    const r = await sendSMS('666 35 13 19', 'Recuerda tu cita', { fetch: fakeFetch });
    assert.equal(r.ok, true);
    assert.equal(r.sid, 'msg_1');
    assert.equal(captured.body.to, '+34666351319');
    assert.equal(captured.body.from, '+34843000000');
    assert.equal(captured.auth, 'Bearer k');
    assert.ok(captured.url.includes('/v2/messages'));
  });

  test('destino inválido → {ok:false} sin llamar a fetch', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = '+34843000000';
    let called = false;
    const r = await sendSMS('abc', 'hola', { fetch: async () => { called = true; } });
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });

  test('fail-open: si fetch lanza, devuelve {ok:false} sin propagar', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = '+34843000000';
    const r = await sendSMS('666351319', 'hola', { fetch: async () => { throw new Error('boom'); } });
    assert.equal(r.ok, false);
    assert.match(r.error, /boom/);
  });

  test('incluye messaging_profile_id cuando está definido', async () => {
    process.env.SMS_ENABLED = 'true';
    process.env.TELNYX_API_KEY = 'k';
    process.env.SMS_FROM = 'NodeFlow';
    process.env.SMS_MESSAGING_PROFILE_ID = 'mp_9';
    let body = null;
    await sendSMS('666351319', 'hola', { fetch: async (u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ data: {} }) }; } });
    assert.equal(body.messaging_profile_id, 'mp_9');
    assert.equal(body.from, 'NodeFlow');
  });
});
