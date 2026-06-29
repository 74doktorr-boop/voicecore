#!/usr/bin/env node
// ============================================================
// NodeFlow — Setup del cobro de minutos extra (overage) en Stripe
//
// Crea (idempotente): un Billing Meter + un precio MEDIDO de 0,10 €/min
// ligado a ese meter. NO toca suscripciones ni Payment Links (eso lo haces
// tú en el panel, porque cambia lo que se cobra a clientes).
//
// USO:
//   1) DRY-RUN (no crea nada, solo muestra qué haría):
//        node scripts/setup-stripe-overage.js
//   2) TEST mode (recomendado primero): exporta tu clave de TEST y ejecuta:
//        STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe-overage.js --apply
//   3) PRODUCCIÓN (cuando lo hayas visto en test):
//        STRIPE_SECRET_KEY=sk_live_xxx node scripts/setup-stripe-overage.js --apply
//
// La clave se lee de la env STRIPE_SECRET_KEY (o del .env del proyecto).
// El precio por minuto se ajusta con OVERAGE_PRICE_CENTS (por defecto 10 = 0,10 €).
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const EVENT_NAME      = process.env.STRIPE_OVERAGE_METER_EVENT || 'nodeflow_overage_minutes';
const PRICE_CENTS     = parseInt(process.env.OVERAGE_PRICE_CENTS || '10', 10); // 10 = 0,10 €
const CURRENCY        = (process.env.OVERAGE_CURRENCY || 'eur').toLowerCase();
const PRODUCT_NAME    = 'NodeFlow — Minutos extra';
const APPLY           = process.argv.includes('--apply');

// Lee STRIPE_SECRET_KEY de la env o del .env del proyecto.
function getKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY.trim();
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  return null;
}

async function main() {
  const key = getKey();
  const mode = key ? (key.startsWith('sk_live') ? 'LIVE 🔴' : 'TEST 🟢') : 'SIN CLAVE';

  console.log('\n── Setup overage Stripe ─────────────────────────────');
  console.log(`  Meter event : ${EVENT_NAME}`);
  console.log(`  Precio      : ${(PRICE_CENTS / 100).toFixed(2)} ${CURRENCY.toUpperCase()} / minuto`);
  console.log(`  Modo cuenta : ${mode}`);
  console.log(`  Acción      : ${APPLY ? 'APLICAR (crea en Stripe)' : 'DRY-RUN (no crea nada)'}`);
  console.log('─────────────────────────────────────────────────────\n');

  if (!APPLY) {
    console.log('Esto es un DRY-RUN. Para crearlo de verdad, repite con --apply.');
    console.log('Recomendado: primero con una clave sk_test_ para verlo en modo prueba.\n');
    console.log('Crearía:');
    console.log(`  1. Billing Meter "${PRODUCT_NAME}"  (event_name=${EVENT_NAME}, aggregation=sum)`);
    console.log(`  2. Producto "${PRODUCT_NAME}" + precio medido ${(PRICE_CENTS/100).toFixed(2)} ${CURRENCY.toUpperCase()}/min ligado al meter`);
    console.log('\nLuego TÚ (en el panel): añade ese precio al Payment Link / suscripciones,');
    console.log(`y pon STRIPE_OVERAGE_METER_EVENT=${EVENT_NAME} en EasyPanel.\n`);
    return;
  }

  if (!key) {
    console.error('❌ Falta STRIPE_SECRET_KEY (en la env o en .env). Aborto.');
    process.exit(1);
  }

  const stripe = require('stripe')(key);

  // 1. Meter — idempotente: reusa si ya existe uno con ese event_name.
  let meter;
  const existing = await stripe.billing.meters.list({ limit: 100 });
  meter = existing.data.find(m => m.event_name === EVENT_NAME && m.status === 'active');
  if (meter) {
    console.log(`✓ Meter ya existe: ${meter.id} (event_name=${EVENT_NAME})`);
  } else {
    meter = await stripe.billing.meters.create({
      display_name: PRODUCT_NAME,
      event_name:   EVENT_NAME,
      default_aggregation: { formula: 'sum' },
      customer_mapping:    { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings:      { event_payload_key: 'value' },
    });
    console.log(`✓ Meter creado: ${meter.id}`);
  }

  // 2. Producto + precio medido ligado al meter.
  const product = await stripe.products.create({ name: PRODUCT_NAME });
  const price = await stripe.prices.create({
    currency:    CURRENCY,
    unit_amount: PRICE_CENTS,
    product:     product.id,
    recurring:   { interval: 'month', usage_type: 'metered', meter: meter.id },
  });
  console.log(`✓ Producto creado: ${product.id}`);
  console.log(`✓ Precio medido creado: ${price.id}  (${(PRICE_CENTS/100).toFixed(2)} ${CURRENCY.toUpperCase()}/min)`);

  console.log('\n✅ Listo. Ahora, en el panel de Stripe:');
  console.log(`   · Añade el precio ${price.id} a tu Payment Link y/o a las suscripciones existentes.`);
  console.log(`   · En EasyPanel pon: STRIPE_OVERAGE_METER_EVENT=${EVENT_NAME}`);
  console.log('   Con eso, los minutos extra se cobran solos.\n');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
