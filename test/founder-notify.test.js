// ============================================================
// NodeFlow — Aviso al fundador (2026-07-06)
// Doble canal (WhatsApp + email) best-effort: informa a Unai de
// eventos como el clonado de voz sin bloquear al cliente.
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { notifyFounder } = require('../src/notifications/founder');

// Stub de los require internos ('./whatsapp', './email') durante la llamada.
function withStubs(stubs, fn) {
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === './whatsapp' && stubs.whatsapp) return stubs.whatsapp;
    if (id === './email' && stubs.email) return stubs.email;
    return orig.apply(this, arguments);
  };
  return Promise.resolve().then(fn).finally(() => { Module.prototype.require = orig; });
}

describe('notifyFounder', () => {
  afterEach(() => { delete process.env.NOTIFY_EMAIL; });

  test('manda WhatsApp + email con el mismo cuerpo', async () => {
    process.env.NOTIFY_EMAIL = 'unai@x.es';
    let waText = null, emailArg = null;
    await withStubs({
      whatsapp: { sendWhatsApp: async (t) => { waText = t; return { ok: true }; } },
      email: { sendEmail: async (a) => { emailArg = a; return true; } },
    }, async () => {
      const r = await notifyFounder({ subject: 'S', text: 'Osakin ha clonado su voz' });
      assert.strictEqual(r.whatsapp, true);
      assert.strictEqual(r.email, true);
      assert.strictEqual(waText, 'Osakin ha clonado su voz');
      assert.strictEqual(emailArg.to, 'unai@x.es');
      assert.match(emailArg.html, /Osakin ha clonado su voz/);
    });
  });

  test('sin NOTIFY_EMAIL → solo WhatsApp, email omitido', async () => {
    let sent = false;
    await withStubs({
      whatsapp: { sendWhatsApp: async () => { return { ok: true }; } },
      email: { sendEmail: async () => { sent = true; return true; } },
    }, async () => {
      const r = await notifyFounder({ subject: 'S', text: 'x' });
      assert.strictEqual(r.whatsapp, true);
      assert.strictEqual(r.email, false);
      assert.strictEqual(sent, false);
    });
  });

  test('nunca lanza aunque los dos canales fallen', async () => {
    process.env.NOTIFY_EMAIL = 'unai@x.es';
    await withStubs({
      whatsapp: { sendWhatsApp: async () => { throw new Error('boom'); } },
      email: { sendEmail: async () => { throw new Error('boom'); } },
    }, async () => {
      const r = await notifyFounder({ subject: 'S', text: 'x' });
      assert.strictEqual(r.whatsapp, false);
      assert.strictEqual(r.email, false);
    });
  });
});
