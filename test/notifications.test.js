// ============================================================
// NodeFlow — Notification emails tests
// Ejecutar: npm test  (node --test test/)
// Sin dependencias externas — usa node:test nativo (Node 18+).
//
// Blinda la cobertura por sector e idioma de los emails de
// ciclo de vida (rebooking, segundo toque y no-show) y la
// alineación entre los sectores del onboarding y el backend:
// ningún sector del desplegable debe caer a copy genérico.
// ============================================================

'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-smoke-tests-only';
process.env.NODE_ENV   = 'test';
delete process.env.RESEND_API_KEY; // garantiza que no se envía nada real

const { test, describe, before } = require('node:test');
const assert = require('node:assert');

// ── Interceptar sendEmail ANTES de cargar los módulos de notificación ─────────
// Los módulos hacen `const { sendEmail } = require('./email')` al evaluarse,
// así que parcheamos el export antes de requerirlos.
const emailMod = require('../src/notifications/email');
const SENT = [];
emailMod.sendEmail = async (payload) => { SENT.push(payload); return { ok: true, stubbed: true }; };

const { sendRebookingEmail, sendRebookingFollowUp } = require('../src/notifications/rebooking-notifications');
const { sendNoShowEmail } = require('../src/notifications/noshow-notifications');

// Sectores ofrecidos en el desplegable de public/onboarding.html (sin idioma ni "otro").
const ONBOARDING_SECTORS = [
  'clinica', 'dental', 'fisioterapia', 'psicologia', 'nutricion', 'farmacia',
  'veterinaria', 'optica', 'podologia', 'peluqueria', 'gimnasio', 'yoga',
  'spa', 'restaurante', 'hotel', 'agencia_viajes', 'asesoria', 'abogados',
  'inmobiliaria', 'academia', 'coaching', 'autoescuela', 'taller', 'reformas',
  'guarderia_canina',
];
// Sectores con cita (deben tener no-show a medida; farmacia no tiene citas).
const APPOINTMENT_SECTORS = ONBOARDING_SECTORS.filter(s => s !== 'farmacia');
const LANGS = ['es', 'eu', 'gl'];

const CLIENT = { name: 'Ana López García', email: 'ana@example.com', phone: '666111222' };
const APT    = { email: 'ana@example.com', patientName: 'Ana López García', date: '2026-06-20', time: '10:00', service: 'cita' };
const cfg = (lang, sector) => ({ name: 'Negocio Demo', ownerPhone: '666111222', language: lang, sector });

function last() { return SENT[SENT.length - 1]; }
function assertValid(payload, ctx) {
  assert.ok(payload, `${ctx}: no se llamó a sendEmail`);
  assert.ok(payload.subject && payload.subject.length > 0, `${ctx}: subject vacío`);
  assert.ok(payload.html && payload.html.includes('<!DOCTYPE'), `${ctx}: html sin DOCTYPE`);
  assert.ok(!payload.html.includes('undefined'), `${ctx}: html contiene "undefined"`);
  assert.ok(payload.text && payload.text.length > 0, `${ctx}: text vacío`);
}

// ── Rebooking (recordatorio de recompra) ──────────────────────────────────────

describe('rebooking: recordatorio por sector e idioma', () => {
  for (const sector of ONBOARDING_SECTORS) {
    for (const lang of LANGS) {
      test(`${sector}/${lang} genera email válido`, async () => {
        SENT.length = 0;
        await sendRebookingEmail(CLIENT, cfg(lang, sector), '2026-05-01');
        assertValid(last(), `rebooking ${sector}/${lang}`);
      });
    }
  }

  test('ningún sector del onboarding cae al copy genérico (default)', async () => {
    // El copy default es 'Hace tiempo que no te vemos' — ningún sector dedicado debe usarlo.
    for (const sector of ONBOARDING_SECTORS) {
      SENT.length = 0;
      await sendRebookingEmail(CLIENT, cfg('es', sector), '2026-05-01');
      assert.ok(
        !last().subject.includes('Hace tiempo que no te vemos'),
        `${sector} está usando el copy genérico en vez del suyo`
      );
    }
  });

  test('es/eu/gl producen textos distintos (no es fallback a español)', async () => {
    // Comparamos el HTML del cuerpo: algún título (p.ej. "Recordatorio de revisión")
    // coincide entre gl y es por ser la misma frase, pero el cuerpo siempre difiere.
    for (const sector of ['clinica', 'taller', 'gimnasio', 'podologia', 'spa']) {
      const html = {};
      for (const lang of LANGS) {
        SENT.length = 0;
        await sendRebookingEmail(CLIENT, cfg(lang, sector), '2026-05-01');
        html[lang] = last().html;
      }
      assert.notStrictEqual(html.eu, html.es, `${sector}: euskera == español (fallback)`);
      assert.notStrictEqual(html.gl, html.es, `${sector}: galego == español (fallback)`);
    }
  });
});

// ── Rebooking segundo toque (follow-up) ───────────────────────────────────────

describe('rebooking: segundo toque por sector e idioma', () => {
  for (const sector of ONBOARDING_SECTORS) {
    for (const lang of LANGS) {
      test(`${sector}/${lang} genera follow-up válido`, async () => {
        SENT.length = 0;
        await sendRebookingFollowUp(CLIENT, cfg(lang, sector));
        assertValid(last(), `follow-up ${sector}/${lang}`);
      });
    }
  }
});

// ── No-show ───────────────────────────────────────────────────────────────────

describe('no-show: por sector con cita e idioma', () => {
  for (const sector of APPOINTMENT_SECTORS) {
    for (const lang of LANGS) {
      test(`${sector}/${lang} genera no-show válido`, async () => {
        SENT.length = 0;
        await sendNoShowEmail(APT, cfg(lang, sector));
        assertValid(last(), `no-show ${sector}/${lang}`);
      });
    }
  }

  test('los sectores con cita no usan el no-show genérico', async () => {
    for (const sector of APPOINTMENT_SECTORS) {
      SENT.length = 0;
      await sendNoShowEmail(APT, cfg('es', sector));
      // El hook genérico default es 'Vimos que no pudiste venir hoy'.
      assert.ok(
        !last().subject.includes('Vimos que no pudiste venir hoy') &&
        !last().html.includes('Vimos que no pudiste venir hoy'),
        `${sector} usa el no-show genérico en vez del suyo`
      );
    }
  });

  test('no envía si falta el email del cliente', async () => {
    SENT.length = 0;
    const res = await sendNoShowEmail({ patientName: 'Sin Email', date: '2026-06-20', time: '10:00' }, cfg('es', 'dental'));
    assert.strictEqual(SENT.length, 0, 'no debería haber enviado sin email');
    assert.strictEqual(res, false);
  });
});
