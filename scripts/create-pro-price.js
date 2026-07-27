'use strict';
// ============================================================
// NodeFlow — Crea el PRECIO del add-on 'pro' (+36€/mes) en Stripe (2026-07-27)
// El salto Básico→Pro (49 + 36 = 85). Idempotente vía lookup_key: si ya existe,
// NO duplica, solo lo reporta. NUNCA toca el precio base de 49€. No mueve dinero
// (crear un Price ≠ cobrar). Tras ejecutarlo: pega el id en EasyPanel como
// STRIPE_ADDON_PRO_PRICE_ID y redeploy.
//
//   node scripts/create-pro-price.js          → crea (o reporta si ya existe)
//   node scripts/create-pro-price.js --dry     → solo muestra qué haría
// ============================================================
require('dotenv').config();

const AMOUNT_CENTS = 3600;              // 36,00 € — el salto sobre la base de 49€
const CURRENCY = 'eur';
const LOOKUP_KEY = 'nodeflow_pro_upgrade_36';
const PRODUCT_NAME = 'NodeFlow · Plan Pro (upgrade)';
const DRY = process.argv.includes('--dry');

(async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('✗ Falta STRIPE_SECRET_KEY'); process.exit(1); }
  const live = key.startsWith('sk_live') || key.startsWith('rk_live');
  const stripe = require('stripe')(key);

  console.log(`\n== Crear precio add-on Pro ==  modo: ${live ? 'LIVE ⚠️' : 'TEST'}`);
  console.log(`   ${PRODUCT_NAME}`);
  console.log(`   ${(AMOUNT_CENTS / 100).toFixed(2)} ${CURRENCY.toUpperCase()} / mes · recurrente · lookup_key=${LOOKUP_KEY}\n`);

  // 1) ¿Ya existe? (idempotencia por lookup_key) — no duplicar en re-ejecuciones.
  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, expand: ['data.product'], limit: 1 });
  if (existing.data.length) {
    const p = existing.data[0];
    console.log('✓ YA EXISTE — no se crea nada nuevo (idempotente).');
    console.log(`  Price ID: ${p.id}`);
    console.log(`  Importe:  ${(p.unit_amount / 100).toFixed(2)} ${p.currency.toUpperCase()} / ${p.recurring?.interval}`);
    console.log(`\n→ STRIPE_ADDON_PRO_PRICE_ID=${p.id}\n`);
    return;
  }

  if (DRY) { console.log('· DRY-RUN: no existe → se crearía producto + precio. (sin cambios)\n'); return; }

  // 2) Salvaguarda anti-error: verifica que NO estamos tocando el precio base 49€.
  const basePriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (basePriceId) console.log(`  (base 49€ intacto: ${basePriceId})`);

  // 3) Crear producto + precio recurrente mensual.
  const product = await stripe.products.create({
    name: PRODUCT_NAME,
    description: 'Desbloquea el motor de seguimientos completo (reseñas, reactivación, plantones, avisos por entidad, informe completo e integraciones). Se suma a la base de 49€ = 85€/mes.',
    metadata: { nodeflow_role: 'pro_upgrade_addon' },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: AMOUNT_CENTS,
    currency: CURRENCY,
    recurring: { interval: 'month' },
    lookup_key: LOOKUP_KEY,
    metadata: { nodeflow_role: 'pro_upgrade_addon' },
  });

  console.log('✓ CREADO.');
  console.log(`  Product ID: ${product.id}`);
  console.log(`  Price ID:   ${price.id}`);
  console.log(`\n→ Pega esto en EasyPanel y redeploy:\n   STRIPE_ADDON_PRO_PRICE_ID=${price.id}\n`);
})().catch(e => { console.error('✗ Error:', e.message); process.exit(1); });
