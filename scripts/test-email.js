#!/usr/bin/env node
// ============================================================
// NodeFlow — Test del sistema de emails (Resend)
// Envía un email de prueba a unai@nodeflow.es
// Uso: node scripts/test-email.js
// ============================================================

require('dotenv').config();

// Mock registro de prueba
const mockRegistro = {
  id: 'reg_test_' + Date.now(),
  sector: 'Peluquería / Barbería',
  negocio: 'TEST Pelox Barbershop',
  contacto: 'Unai Test',
  ciudad: 'Bilbao',
  telefono: '+34 666 351 319',
  email: process.env.NOTIFY_EMAIL || 'unai@nodeflow.es',
  plan: 'negocio',
  voz: 'Sofia',
  idioma: 'Castellano + Euskera',
  saludo: 'Buenas, gracias por llamar a Pelox. ¿En qué te puedo ayudar?',
  horario: {
    lun: { on: true, from: '09:00', to: '20:00' },
    mar: { on: true, from: '09:00', to: '20:00' },
    mie: { on: true, from: '09:00', to: '20:00' },
    jue: { on: true, from: '09:00', to: '20:00' },
    vie: { on: true, from: '09:00', to: '20:00' },
    sab: { on: true, from: '10:00', to: '18:00' },
    dom: { on: false },
  },
  stripe_customer_id: 'cus_test_123',
  api_key: 'vc_test_key_abc123def456',
  created_at: new Date().toISOString(),
};

async function main() {
  console.log('📧  Probando sistema de emails NodeFlow…\n');

  const { sendEmail, notifyNuevoCliente, sendBienvenida } = require('../src/notifications/email');

  // Test 1: Notificación interna (a Unai)
  console.log('1️⃣   Enviando notificación interna (notifyNuevoCliente)…');
  const r1 = await notifyNuevoCliente(mockRegistro);
  console.log(r1 ? '   ✅  Email interno enviado OK' : '   ❌  Email interno FALLIDO');

  // Test 2: Bienvenida al cliente
  console.log('2️⃣   Enviando email de bienvenida al cliente (sendBienvenida)…');
  const r2 = await sendBienvenida(mockRegistro);
  console.log(r2 ? '   ✅  Email bienvenida enviado OK' : '   ❌  Email bienvenida FALLIDO');

  // Test 3: Email genérico
  console.log('3️⃣   Enviando email de prueba genérico…');
  const r3 = await sendEmail({
    to: mockRegistro.email,
    subject: '✅ Test NodeFlow Email System — ' + new Date().toLocaleTimeString('es'),
    text: 'Este es un test del sistema de emails de NodeFlow. Si recibes esto, todo funciona correctamente.',
    html: '<h2 style="color:#6c5ce7">✅ NodeFlow Email Test</h2><p>Sistema de emails funcionando correctamente.</p><p>Hora: ' + new Date().toISOString() + '</p>',
  });
  console.log(r3 ? '   ✅  Email genérico enviado OK' : '   ❌  Email genérico FALLIDO');

  console.log('\n✨  Test completado. Revisa tu bandeja de entrada en ' + mockRegistro.email);
}

main().catch(e => { console.error('❌  Error:', e.message); process.exit(1); });
