#!/usr/bin/env node
// ============================================================
// NodeFlow — Vonage Voice API Setup Helper
// Ejecutar cuando la cuenta Vonage esté desbloqueada
// Uso: node scripts/vonage-setup.js
// ============================================================

require('dotenv').config();
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const API_KEY    = process.env.VONAGE_API_KEY;
const API_SECRET = process.env.VONAGE_API_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://nodeflow.es';

// ───────���────────────────────────────────────────────────────
// PASO 1: Verifica credenciales Vonage
// ───────────────────────────────���────────────────────────────
async function checkCredentials() {
  console.log('\n━━━ PASO 1: Verificar credenciales Vonage ━━━\n');

  if (!API_KEY || !API_SECRET) {
    console.log('❌  VONAGE_API_KEY o VONAGE_API_SECRET no están en .env');
    console.log('   → Ve a dashboard.nexmo.com → Settings → API settings');
    console.log('   → Copia API key y API secret');
    console.log('   → Añade al .env en el servidor:');
    console.log('      docker service update --env-add VONAGE_API_KEY=xxxx --env-add VONAGE_API_SECRET=xxxx voicecore_voicecore-api');
    return false;
  }

  return new Promise((resolve) => {
    const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
    const req = https.request({
      hostname: 'api.nexmo.com',
      path: '/account/get-balance',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const r = JSON.parse(d);
          console.log(`✅  Credenciales OK`);
          console.log(`   Saldo: €${parseFloat(r.value).toFixed(2)}`);
          if (parseFloat(r.value) < 5) {
            console.log('   ⚠️   Saldo bajo — recarga en dashboard.nexmo.com');
          }
          resolve(true);
        } else {
          console.log(`❌  Error de autenticación (HTTP ${res.statusCode})`);
          console.log(`   Respuesta: ${d}`);
          resolve(false);
        }
      });
    });
    req.on('error', e => { console.log(`❌  Error de red: ${e.message}`); resolve(false); });
    req.end();
  });
}

// ────────────────────────────────────��───────────────────────
// PASO 2: Crea la aplicación Vonage (si no existe)
// ─���────────────────────────────��───────────────────────────��─
async function createOrGetApp() {
  console.log('\n━━━ PASO 2: Crear aplicación Vonage ━━━\n');

  const appId = process.env.VONAGE_APPLICATION_ID;
  if (appId) {
    console.log(`✅  Aplicación ya configurada: ${appId}`);
    return appId;
  }

  const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  const body = JSON.stringify({
    name: 'NodeFlow VoiceCore',
    capabilities: {
      voice: {
        webhooks: {
          answer_url: {
            address: `${PUBLIC_URL}/vonage/answer`,
            http_method: 'GET',
          },
          event_url: {
            address: `${PUBLIC_URL}/vonage/event`,
            http_method: 'POST',
          },
        },
      },
    },
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.nexmo.com',
      path: '/v2/applications',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 201) {
          const r = JSON.parse(d);
          console.log(`✅  Aplicación creada: ${r.id}`);
          console.log(`   Nombre: ${r.name}`);
          console.log(`   Answer URL: ${r.capabilities?.voice?.webhooks?.answer_url?.address}`);
          console.log(`   Event URL:  ${r.capabilities?.voice?.webhooks?.event_url?.address}`);

          // Guardar private key
          if (r.keys?.private_key) {
            const keyPath = path.join(__dirname, '..', 'vonage_private.key');
            fs.writeFileSync(keyPath, r.keys.private_key);
            console.log(`\n   🔑  Private key guardada en: vonage_private.key`);
            console.log(`   ⚠️   NO subas este archivo a GitHub!`);
          }

          console.log('\n   ━━ Añade estas variables en producción: ━━');
          console.log(`   docker service update \\`);
          console.log(`     --env-add VONAGE_APPLICATION_ID=${r.id} \\`);
          console.log(`     --env-add VONAGE_PRIVATE_KEY_PATH=/app/vonage_private.key \\`);
          console.log(`     voicecore_voicecore-api`);

          resolve(r.id);
        } else {
          console.log(`❌  Error creando app (HTTP ${res.statusCode}): ${d}`);
          resolve(null);
        }
      });
    });
    req.on('error', e => { console.log(`❌  ${e.message}`); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ──────────────────���─────────────────────────────────────────
// PASO 3: Listar números disponibles en España (+34)
// ──────────���────────────────────────────────────────────────��
async function listAvailableNumbers() {
  console.log('\n━━━ PASO 3: Números disponibles +34 ━━━\n');

  const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'rest.nexmo.com',
      path: '/number/search?country=ES&features=VOICE&size=10',
      headers: { 'Authorization': `Basic ${auth}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const r = JSON.parse(d);
          const numbers = r.numbers || [];
          if (numbers.length === 0) {
            console.log('⚠️  No hay números +34 disponibles ahora mismo');
            console.log('   Inténtalo en unos minutos o contacta soporte Vonage');
          } else {
            console.log(`✅  ${numbers.length} números disponibles:`);
            numbers.slice(0, 5).forEach(n => {
              console.log(`   📞  +${n.msisdn}  (${n.type})  €${n.cost}/mes`);
            });
            console.log(`\n   Para comprar el primer número, ejecuta:`);
            console.log(`   node scripts/vonage-setup.js --buy +${numbers[0].msisdn}`);
          }
          resolve(numbers);
        } else {
          console.log(`❌  Error buscando números (HTTP ${res.statusCode}): ${d}`);
          resolve([]);
        }
      });
    });
    req.on('error', e => { console.log(`❌  ${e.message}`); resolve([]); });
    req.end();
  });
}

// ────────────────���────────────────────────────��──────────────
// PASO 4: Comprar número y vincular a aplicación
// ─────────���────────────────────���─────────────────────────────
async function buyNumber(msisdn, appId) {
  console.log(`\n━━━ Comprando número +${msisdn} ━━━\n`);

  const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  const number = msisdn.replace(/^\+34/, '34').replace(/^\+/, '');

  // 1. Buy
  const buyBody = `country=ES&msisdn=${number}`;
  await new Promise((resolve) => {
    const req = https.request({
      hostname: 'rest.nexmo.com',
      path: '/number/buy',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(buyBody),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`✅  Número +${number} comprado`);
        } else {
          console.log(`❌  Error comprando (HTTP ${res.statusCode}): ${d}`);
        }
        resolve();
      });
    });
    req.write(buyBody);
    req.end();
  });

  // 2. Link to app
  if (appId) {
    const linkBody = `country=ES&msisdn=${number}&app_id=${appId}`;
    await new Promise((resolve) => {
      const req = https.request({
        hostname: 'rest.nexmo.com',
        path: '/number/update',
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(linkBody),
        }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`✅  Número +${number} vinculado a aplicación ${appId}`);
            console.log(`\n   ━━ Añade en producción: ━━`);
            console.log(`   docker service update --env-add VONAGE_PHONE_NUMBER=+${number} voicecore_voicecore-api`);
          } else {
            console.log(`❌  Error vinculando (${res.statusCode}): ${d}`);
          }
          resolve();
        });
      });
      req.write(linkBody);
      req.end();
    });
  }
}

// ─────────��─────────────────────────────────────────���────────
// PASO 5: Test de llamada entrante (simula un webhook)
// ──────────��─────────────────────────────────────────────────
async function testWebhook() {
  console.log('\n━━━ PASO 5: Test de webhook Vonage ━━━\n');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'nodeflow.es',
      path: '/vonage/answer?from=34666000000&to=34900000000',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const ncco = JSON.parse(d);
            console.log(`✅  Webhook /vonage/answer responde OK`);
            console.log(`   NCCO action: ${ncco[0]?.action}`);
            console.log(`   WebSocket URI: ${ncco[0]?.endpoint?.[0]?.uri}`);
          } catch {
            console.log(`✅  Respuesta OK (HTTP 200)`);
          }
        } else {
          console.log(`❌  Webhook respondió HTTP ${res.statusCode}`);
          console.log(`   Respuesta: ${d.slice(0, 200)}`);
        }
        resolve();
      });
    });
    req.on('error', e => { console.log(`❌  No se pudo conectar a nodeflow.es: ${e.message}`); resolve(); });
    req.end();
  });
}

// ──��────────────────────────────────────────���────────────────
// MAIN
// ────────────────────────────────────────────���───────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  NodeFlow — Vonage Voice API Setup           ║');
  console.log('╚════════════���═════════════════════════════════╝');

  const args = process.argv.slice(2);

  // --buy +34XXXXXXXXX
  if (args[0] === '--buy') {
    const msisdn = args[1];
    if (!msisdn) { console.error('Uso: node vonage-setup.js --buy +34XXXXXXXXX'); process.exit(1); }
    const appId = process.env.VONAGE_APPLICATION_ID;
    await buyNumber(msisdn, appId);
    return;
  }

  // --test
  if (args[0] === '--test') {
    await testWebhook();
    return;
  }

  // Setup completo
  const credOk = await checkCredentials();
  if (!credOk) {
    console.log('\n⚠️   Configura las credenciales antes de continuar.\n');
    process.exit(1);
  }

  const appId = await createOrGetApp();
  await listAvailableNumbers();

  console.log('\n━━━ RESUMEN ━━━\n');
  console.log('Próximos pasos:');
  console.log('1. Compra un número:    node scripts/vonage-setup.js --buy +34XXXXXXXXX');
  console.log('2. Actualiza el .env con VONAGE_PHONE_NUMBER');
  console.log('3. Sube la private key al servidor: scp vonage_private.key root@nodeflow.es:/app/');
  console.log('4. Prueba el webhook:   node scripts/vonage-setup.js --test');
  console.log('5. Haz una llamada de prueba desde tu móvil al número comprado\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
