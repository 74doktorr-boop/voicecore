// ============================================================
// NodeFlow — Aviso al dueño al cancelar la suscripción (Tema B, 2026-07)
// Bug: al cancelar, se desactivaba la org y se LIBERABA su número al pool
// (reasignable = pérdida irreversible) SIN avisar al dueño — a diferencia de
// payment_failed que sí manda email. Un negocio perdía su línea en silencio.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { cancelledEmailContent, sendSubscriptionCancelled } = require('../src/notifications/email');

describe('cancelledEmailContent', () => {
  test('menciona el número liberado y la reactivación', () => {
    const c = cancelledEmailContent('Unai Pérez', '+34843700849');
    assert.match(c.subject, /cancelad/i);
    assert.match(c.html, /\+34843700849/);
    assert.match(c.html, /reactiv/i);
    assert.match(c.text, /\+34843700849/);
    assert.match(c.html, /Unai/); // saluda por el nombre de pila
  });

  test('avisa de que el número puede reasignarse (urgencia honesta)', () => {
    const c = cancelledEmailContent('Ana', '+34600111222');
    assert.match(c.html, /reasignar|date prisa|cuanto antes/i);
  });

  test('no culpa al dueño ni asume impago (una cancelación puede ser un error)', () => {
    const c = cancelledEmailContent('Ana', '+34600111222');
    assert.doesNotMatch(c.html, /no has pagado|impago|tu culpa/i);
  });

  test('sin número: texto genérico, no rompe', () => {
    const c = cancelledEmailContent('Ana', null);
    assert.match(c.html, /tu número/);
    assert.ok(c.subject && c.html && c.text);
  });
});

describe('sendSubscriptionCancelled', () => {
  test('envía al dueño con el contenido correcto', async () => {
    let sent = null;
    const ok = await sendSubscriptionCancelled(
      { email: 'a@b.es', name: 'Ana', number: '+34600111222' },
      { sendEmail: async (m) => { sent = m; } },
    );
    assert.strictEqual(ok, true);
    assert.strictEqual(sent.to, 'a@b.es');
    assert.match(sent.subject, /cancelad/i);
    assert.match(sent.html, /\+34600111222/);
  });

  test('sin email → no envía, no lanza', async () => {
    let called = false;
    const ok = await sendSubscriptionCancelled(
      { email: null, name: 'Ana', number: '+34600111222' },
      { sendEmail: async () => { called = true; } },
    );
    assert.strictEqual(ok, false);
    assert.strictEqual(called, false);
  });

  test('si sendEmail falla, devuelve false sin propagar', async () => {
    const ok = await sendSubscriptionCancelled(
      { email: 'a@b.es', name: 'Ana', number: '+34600111222' },
      { sendEmail: async () => { throw new Error('resend caído'); } },
    );
    assert.strictEqual(ok, false);
  });
});
