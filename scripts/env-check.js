#!/usr/bin/env node
// ============================================================
// NodeFlow — Verificador de variables de entorno para PRODUCCIÓN
//
// Dice qué falta SIN mostrar NUNCA ningún valor (solo ✅ presente / ❌ falta).
// Seguro de pegar en cualquier sitio: no imprime secretos.
//
// Uso:
//   node scripts/env-check.js            (en el contenedor de EasyPanel, o local
//                                          con el .env de producción cargado)
//
// Sale con código 1 si falta alguna CRÍTICA (para usar en CI/healthcheck).
// ============================================================
'use strict';

// Carga .env si existe (para correrlo en local), sin romper si no está dotenv.
try { require('dotenv').config(); } catch (_) {}

const has = (k) => typeof process.env[k] === 'string' && process.env[k].trim() !== '';

// Críticas: sin ellas se rompe algo del núcleo.
const CRITICAL = [
  ['SUPABASE_URL',              'Base de datos'],
  ['SUPABASE_SERVICE_KEY',      'Base de datos'],
  ['DEEPGRAM_API_KEY',          'STT (oír al cliente)'],
  ['OPENAI_API_KEY',            'LLM + embeddings'],
  ['GROQ_API_KEY',              'LLM rápido (default)'],
  ['TELNYX_API_KEY',            'Telefonía'],
  ['TELNYX_PHONE_NUMBER',       'Telefonía'],
  ['TELNYX_APP_ID',             'Telefonía (TeXML App)'],
  ['TELNYX_NUMBER_AREACODE',    'Comprar nº al pool'],
  ['TELNYX_REQUIREMENT_GROUP_ID','Comprar nº al pool (ES)'],
  ['STRIPE_SECRET_KEY',         'Cobro'],
  ['STRIPE_WEBHOOK_SECRET',     'Alta automática (webhook)'],
  ['STRIPE_BUSINESS_PRICE_ID',  'Plan €49'],
  ['JWT_SECRET',                'Login del portal'],
  ['DASHBOARD_PASSWORD',        'Panel admin'],
  ['RESEND_API_KEY',            'Emails (magic-link + activación) — falla EN SILENCIO'],
  ['PUBLIC_URL',                'URLs de webhooks y enlaces'],
  ['ENCRYPTION_KEY',            'Cifrado de credenciales WhatsApp'],
  ['NOTIFY_EMAIL',              'Alertas a Unai'],
  ['OWNER_PHONE',               'Alertas a Unai'],
  ['CALLMEBOT_API_KEY',         'Alertas a Unai por WhatsApp'],
];

// Validaciones especiales (no solo "presente").
const SPECIAL = [
  ['API_KEY',   () => has('API_KEY') && process.env.API_KEY !== 'voicecore-dev',
    'Debe estar y NO ser el default "voicecore-dev" (si no, el acceso enterprise se auto-desactiva)'],
  ['ENCRYPTION_KEY', () => has('ENCRYPTION_KEY') && /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY || ''),
    'Debe ser 64 caracteres hex (32 bytes)'],
  ['NODE_ENV', () => process.env.NODE_ENV === 'production',
    'Debe ser exactamente "production" (si no, se siembran datos demo y se apaga el monitor)'],
];

// TTS: basta UNO de estos grupos.
const TTS_OK = has('ELEVENLABS_API_KEY')
  || (has('AZURE_SPEECH_KEY') && has('AZURE_SPEECH_REGION'))
  || has('GOOGLE_TTS_API_KEY');

// Recomendadas para cobro correcto del excedente.
const BILLING = [
  ['STRIPE_OVERAGE_METER_EVENT', 'Cobrar minutos de voz por encima del plan'],
  ['STRIPE_OVERAGE_PRICE_ID',    'Item de overage de voz'],
  ['STRIPE_MSG_METER_EVENT',     'Cobrar mensajes por encima del paquete'],
  ['STRIPE_MSG_PRICE_ID',        'Item de overage de mensajes'],
];

// Opcionales / gating (fallan en blando — solo si usas la feature).
const OPTIONAL = [
  ['ASSEMBLYAI_API_KEY', 'Failover de STT'],
  ['GOOGLE_STT_API_KEY', 'Failover de STT'],
  ['GOOGLE_CLIENT_ID',   'Google Calendar del cliente'],
  ['GOOGLE_CLIENT_SECRET','Google Calendar del cliente'],
  ['GOOGLE_REDIRECT_URI','Google Calendar del cliente'],
  ['WA_APP_ID',          'Embedded Signup de WhatsApp'],
  ['WA_ES_CONFIG_ID',    'Embedded Signup de WhatsApp'],
  ['WA_APP_SECRET',      'Firma del webhook de WhatsApp'],
  ['WA_PHONE_NUMBER_ID', 'Número global de WhatsApp'],
  ['WA_ACCESS_TOKEN',    'Número global de WhatsApp'],
  ['REDIS_URL',          'Solo si escalas a varias réplicas'],
];

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[90m', X = '\x1b[0m';
let missingCritical = 0;

function line(ok, name, note, warn) {
  const mark = ok ? `${G}✅${X}` : (warn ? `${Y}⚠️ ${X}` : `${R}❌${X}`);
  console.log(`  ${mark} ${name.padEnd(30)} ${D}${note}${X}`);
}

console.log('\n▶ NodeFlow — chequeo de variables de entorno (no muestra valores)\n');

console.log('── CRÍTICAS ──');
for (const [k, note] of CRITICAL) { const ok = has(k); if (!ok) missingCritical++; line(ok, k, note); }
for (const [k, test, note] of SPECIAL) { const ok = test(); if (!ok) missingCritical++; line(ok, k, note); }
{ const ok = TTS_OK; if (!ok) missingCritical++; line(ok, 'TTS (voz)', 'al menos: ELEVENLABS_API_KEY / AZURE_SPEECH_* / GOOGLE_TTS_API_KEY'); }

console.log('\n── RECOMENDADAS (cobro correcto del excedente) ──');
for (const [k, note] of BILLING) line(has(k), k, note, true);

console.log('\n── OPCIONALES / según feature ──');
for (const [k, note] of OPTIONAL) line(has(k), k, note, true);

console.log('');
if (missingCritical === 0) {
  console.log(`${G}✔ Todas las CRÍTICAS están puestas.${X}\n`);
  process.exit(0);
} else {
  console.log(`${R}✖ Faltan ${missingCritical} variable(s) CRÍTICA(s) — corrígelas antes de vender.${X}\n`);
  process.exit(1);
}
