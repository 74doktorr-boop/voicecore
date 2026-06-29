#!/usr/bin/env node
// Prueba E2E del reporte de overage: crea un cliente temporal, dispara un meter
// event con el MISMO código de la app (StripeBilling.reportUsage) y lo borra.
// No toca clientes reales ni cobra nada. USO: node scripts/test-stripe-meter.js
'use strict';

const fs = require('fs'), path = require('path');
if (!process.env.STRIPE_SECRET_KEY) {
  const env = path.join(__dirname, '..', '.env');
  if (fs.existsSync(env)) for (const l of fs.readFileSync(env, 'utf8').split('\n')) {
    const m = l.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.+?)\s*$/); if (m) process.env.STRIPE_SECRET_KEY = m[1].replace(/^["']|["']$/g, '').trim();
  }
}
const EVENT = 'nodeflow_overage_minutes';
const { StripeBilling } = require('../src/billing/stripe');

(async () => {
  const billing = new StripeBilling();
  if (!billing.enabled) { console.error('❌ Stripe no configurado'); process.exit(1); }
  const stripe = billing.stripe;

  console.log('1) Creando cliente temporal de prueba…');
  const cus = await stripe.customers.create({ name: 'TEST overage — BORRAR', email: 'nodeflow-test-overage@example.com' });
  console.log('   cliente:', cus.id);

  console.log('2) Disparando meter event (5 min extra) con el código real de la app…');
  await billing.reportUsage({ stripeCustomerId: cus.id, minutes: 5, eventName: EVENT });
  console.log('   ✓ Stripe aceptó el evento (event_name=' + EVENT + ', value=5)');

  console.log('3) Borrando el cliente temporal…');
  await stripe.customers.del(cus.id);
  console.log('   ✓ borrado');

  console.log('\n✅ PRUEBA OK — el reporte de minutos extra funciona de punta a punta.');
})().catch(e => { console.error('❌ FALLO:', e.message); process.exit(1); });
