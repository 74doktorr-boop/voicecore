#!/usr/bin/env node
// ============================================================
// NodeFlow — Verificador de configuración de Stripe (SOLO LECTURA)
//
// Le pregunta a Stripe por API (con la STRIPE_SECRET_KEY del entorno) y comprueba
// lo que la auditoría de lanzamiento marcó como crítico:
//   1. Modo LIVE vs TEST
//   2. Webhook: existe, apunta a PUBLIC_URL, y tiene los 5 eventos requeridos
//   3. Payment Link de la landing: activo, recurrente (suscripción), importe
//   4. Precios de las env vars existen y son del tipo correcto
//
// No modifica NADA. No imprime la clave. Correr en el contenedor de EasyPanel.
// ============================================================
'use strict';

try { require('dotenv').config(); } catch (_) {}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('✖ Falta STRIPE_SECRET_KEY en el entorno.'); process.exit(1); }

let Stripe;
try { Stripe = require('stripe'); }
catch (_) { console.error('✖ El módulo "stripe" no está instalado en este contenedor.'); process.exit(1); }
const stripe = Stripe(key);

const PUBLIC   = (process.env.PUBLIC_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const PLINK    = 'https://buy.stripe.com/28E28sbWE0d76cK3EU24002';   // el hardcodeado en onboarding.html
const REQUIRED = ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed',
                  'customer.subscription.updated', 'customer.subscription.deleted'];
const ok = (b) => (b ? 'OK  ' : 'FALTA ');

(async () => {
  console.log('\n▶ Chequeo de configuración de Stripe (solo lectura)\n');

  // 1. Modo
  const live = key.startsWith('sk_live');
  console.log('MODO: ' + (live ? 'LIVE ✅' : 'TEST ⚠️  (con clave de test los pagos reales NO funcionan)'));

  // 2. Webhooks
  console.log('\n── WEBHOOKS ──');
  const whs = await stripe.webhookEndpoints.list({ limit: 100 });
  if (!whs.data.length) {
    console.log('  ❌ No hay NINGÚN webhook configurado. Sin él, el alta automática no ocurre.');
  }
  for (const w of whs.data) {
    const evs = w.enabled_events || [];
    const all = evs.includes('*');
    const missing = all ? [] : REQUIRED.filter(e => !evs.includes(e));
    const urlOk = PUBLIC && w.url.includes(PUBLIC);
    console.log(`  ${w.status === 'enabled' ? '● activo' : '○ ' + w.status}  ${w.url}`);
    console.log(`     apunta a PUBLIC_URL: ${urlOk ? 'sí ✅' : 'NO coincide ⚠️'}`);
    console.log(`     eventos: ${all ? '* (todos) ✅' : (missing.length ? 'FALTAN → ' + missing.join(', ') + '  ❌' : 'los 5 requeridos ✅')}`);
  }

  // 3. Payment Link
  console.log('\n── PAYMENT LINK (landing) ──');
  let pls = { data: [] };
  try { pls = await stripe.paymentLinks.list({ limit: 100 }); } catch (e) { console.log('  (no se pudo listar: ' + e.message + ')'); }
  const pl = pls.data.find(p => p.url === PLINK);
  if (!pl) {
    console.log(`  ⚠️  No encuentro un payment link con la url de onboarding.html`);
    console.log(`     (${PLINK}) — puede ser de otra cuenta o de modo test.`);
  } else {
    console.log(`  ${pl.active ? '● ACTIVO ✅' : '○ INACTIVO ❌'}  id ${pl.id}`);
    try {
      const li = await stripe.paymentLinks.listLineItems(pl.id, { limit: 5, expand: ['data.price'] });
      for (const item of li.data) {
        const pr = item.price || {};
        const amt = pr.unit_amount != null ? (pr.unit_amount / 100).toFixed(2) + ' ' + (pr.currency || '').toUpperCase() : '(medido)';
        const rec = pr.recurring ? `recurrente / ${pr.recurring.interval}` : '⚠️ PAGO ÚNICO (debería ser suscripción)';
        console.log(`     ${item.quantity}× ${amt} — ${rec}`);
      }
    } catch (e) { console.log('     (no se pudieron leer los items: ' + e.message + ')'); }
  }

  // 4. Precios de env
  console.log('\n── PRECIOS (env vars) ──');
  for (const [k, label] of [['STRIPE_BUSINESS_PRICE_ID', 'Plan €49'], ['STRIPE_OVERAGE_PRICE_ID', 'Overage voz'], ['STRIPE_MSG_PRICE_ID', 'Overage mensajes']]) {
    const id = process.env[k];
    if (!id) { console.log(`  ⚠️  ${k} sin poner (${label})`); continue; }
    try {
      const pr = await stripe.prices.retrieve(id);
      const amt = pr.unit_amount != null ? (pr.unit_amount / 100).toFixed(2) + ' ' + pr.currency.toUpperCase() : (pr.billing_scheme || 'medido');
      const rec = pr.recurring ? `/${pr.recurring.interval}${pr.recurring.usage_type === 'metered' ? ' medido' : ''}` : '';
      console.log(`  ✅ ${k} → ${amt}${rec}  (${label})`);
    } catch (e) { console.log(`  ❌ ${k} → NO existe en esta cuenta (${e.message})`); }
  }

  // 5. Dunning
  console.log('\n── DUNNING / REINTENTOS ──');
  console.log('  ⓘ La config de Smart Retries no es 100% legible por API.');
  console.log('    Verifica en Stripe → Settings → Billing → Manage failed payments:');
  console.log('    Smart Retries activo, ventana de varios días, y que NO cancele al primer fallo.');

  console.log('\n✔ Chequeo terminado (no se modificó nada).\n');
})().catch(e => { console.error('\n✖ Error hablando con Stripe: ' + e.message + '\n'); process.exit(1); });
