// ============================================================
// NodeFlow — Fixes del incidente WhatsApp 2026-07-15 (captura de Unai):
// 1) El botón CONFIRMAR/CANCELAR actuaba sobre "la cita más próxima" del
//    teléfono, no sobre la del recordatorio → con dos citas, LA EQUIVOCADA.
//    Ahora el payload lleva el id (CONFIRMAR:APT-x) y se actúa sobre ESA.
// 2) Seguridad: un id de OTRO teléfono no se acepta (fallback a la próxima).
// 3) "NO PUEDO CONFIRMAR" entraba por la rama CONFIRMAR → ahora cancela.
// 4) El recordatorio envía los botones con payload del id.
// ============================================================
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { handleReply } = require('../src/whatsapp/reply-handler');
const { scheduler } = require('../src/scheduling/scheduler');
const { sendWaReminder } = require('../src/notifications/reminders');

const PHONE = '+34600111222';

function seed(id, date, time, over = {}) {
  const apt = {
    id, businessId: 'org-t', patientName: 'Raúl Test', phone: PHONE,
    service: 'Primera consulta', date, time, duration: 60,
    status: 'confirmed', wa_confirmed: false, ...over,
  };
  scheduler.appointments.set(id, apt);
  return apt;
}

// Fechas futuras estables (mañana y pasado)
const d1 = new Date(); d1.setDate(d1.getDate() + 1);
const d2 = new Date(); d2.setDate(d2.getDate() + 2);
const HOY_MAS_1 = d1.toLocaleDateString('sv-SE');
const HOY_MAS_2 = d2.toLocaleDateString('sv-SE');

describe('handleReply — cita EXACTA por payload (incidente 2026-07-15)', () => {
  beforeEach(() => {
    for (const [k, a] of scheduler.appointments) {
      if (a.businessId === 'org-t') scheduler.appointments.delete(k);
    }
  });

  test('con dos citas, CONFIRMAR:<id> confirma LA DEL RECORDATORIO, no la más próxima', async () => {
    const cercana = seed('APT-T1', HOY_MAS_1, '09:00');
    const lejana  = seed('APT-T2', HOY_MAS_2, '10:30');
    await handleReply({ from: PHONE, type: 'button', payload: 'CONFIRMAR:APT-T2' });
    assert.strictEqual(lejana.wa_confirmed, true, 'la cita del recordatorio queda confirmada');
    assert.strictEqual(cercana.wa_confirmed, false, 'la otra NO se toca');
  });

  test('CANCELAR:<id> cancela exactamente esa cita', async () => {
    const cercana = seed('APT-T3', HOY_MAS_1, '09:00');
    const lejana  = seed('APT-T4', HOY_MAS_2, '10:30');
    await handleReply({ from: PHONE, type: 'button', payload: 'CANCELAR:APT-T4' });
    assert.strictEqual(lejana.status, 'cancelled');
    assert.strictEqual(cercana.status, 'confirmed');
  });

  test('SEGURIDAD: un id de OTRO teléfono no se acepta (fallback a la próxima del que responde)', async () => {
    const ajena  = seed('APT-T5', HOY_MAS_2, '12:00', { phone: '+34999888777' });
    const propia = seed('APT-T6', HOY_MAS_1, '09:00');
    await handleReply({ from: PHONE, type: 'button', payload: 'CONFIRMAR:APT-T5' });
    assert.strictEqual(ajena.wa_confirmed, false, 'la cita de otro teléfono NO se confirma');
    assert.strictEqual(propia.wa_confirmed, true, 'cae a la próxima del remitente');
  });

  test('sin id en el payload (plantilla vieja / texto libre) → la más próxima, como antes', async () => {
    const cercana = seed('APT-T7', HOY_MAS_1, '09:00');
    seed('APT-T8', HOY_MAS_2, '10:30');
    await handleReply({ from: PHONE, type: 'button', payload: 'CONFIRMAR' });
    assert.strictEqual(cercana.wa_confirmed, true);
  });

  test('"NO PUEDO CONFIRMAR" cancela (antes entraba por CONFIRMAR)', async () => {
    const apt = seed('APT-T9', HOY_MAS_1, '09:00');
    await handleReply({ from: PHONE, type: 'text', payload: 'no puedo confirmar la cita' });
    assert.strictEqual(apt.status, 'cancelled');
    assert.strictEqual(apt.wa_confirmed, false);
  });
});

// Auditoría 2026-07-16
describe('handleReply — scope de negocio y cita cancelada', () => {
  beforeEach(() => {
    for (const [k, a] of scheduler.appointments) {
      if (a.businessId === 'org-t' || a.businessId === 'org-otro') scheduler.appointments.delete(k);
    }
  });

  test('cross-tenant: con businessId, NO cancela la cita de otro negocio (misma persona/teléfono)', async () => {
    const ajena  = seed('APT-X1', HOY_MAS_1, '09:00', { businessId: 'org-otro' }); // más próxima, otra org
    const propia = seed('APT-X2', HOY_MAS_2, '10:00', { businessId: 'org-t' });
    // Texto libre "CANCELAR" (sin id) llegando por el webhook de org-t
    await handleReply({ from: PHONE, businessId: 'org-t', type: 'button', payload: 'CANCELAR' });
    assert.strictEqual(ajena.status, 'confirmed', 'la cita de la otra org NO se toca');
    assert.strictEqual(propia.status, 'cancelled', 'se cancela la de la org del webhook');
  });

  test('id de OTRA org → se descarta y cae al fallback de la org del webhook', async () => {
    const ajena  = seed('APT-X3', HOY_MAS_1, '09:00', { businessId: 'org-otro' });
    const propia = seed('APT-X4', HOY_MAS_2, '10:00', { businessId: 'org-t' });
    await handleReply({ from: PHONE, businessId: 'org-t', type: 'button', payload: 'CONFIRMAR:APT-X3' });
    assert.strictEqual(ajena.wa_confirmed, false, 'no se confirma la cita de otra org por su id');
    assert.strictEqual(propia.wa_confirmed, true, 'cae al fallback de la org del webhook');
  });

  test('CONFIRMAR:<id> de una cita CANCELADA → no la confirma (se descarta el id)', async () => {
    const cancelada = seed('APT-X5', HOY_MAS_1, '09:00', { status: 'cancelled' });
    await handleReply({ from: PHONE, businessId: 'org-t', type: 'button', payload: 'CONFIRMAR:APT-X5' });
    assert.strictEqual(cancelada.wa_confirmed, false, 'una cita cancelada no se "confirma"');
  });
});

describe('sendWaReminder — botones con payload del id de la cita', () => {
  test('los quick replies llevan CONFIRMAR:<id> y CANCELAR:<id>', async () => {
    let captured = null;
    const ok = await sendWaReminder(
      { id: 'APT-BTN', businessId: 'org-t', patientName: 'Ana', phone: PHONE, service: 'Fisio', date: HOY_MAS_1, time: '10:30' },
      { name: 'Centro Test', language: 'es' },
      {
        sendTemplate: async (phone, tpl, lang, components) => { captured = components; return { ok: true }; },
        getWaCredentials: async () => ({ token: 'x', phoneNumberId: 'y' }),
        waIsConfigured: () => true,
      }
    );
    assert.strictEqual(ok, true);
    const btns = captured.filter(c => c.type === 'button');
    assert.strictEqual(btns.length, 2);
    assert.strictEqual(btns[0].sub_type, 'quick_reply');
    assert.strictEqual(btns[0].parameters[0].payload, 'CONFIRMAR:APT-BTN');
    assert.strictEqual(btns[1].parameters[0].payload, 'CANCELAR:APT-BTN');
  });
});
