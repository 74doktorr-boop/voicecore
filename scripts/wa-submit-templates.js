#!/usr/bin/env node
// ============================================================
// NodeFlow — Alta de plantillas WhatsApp en Meta (Cloud API)
//
// Da de alta las 3 plantillas UTILITY de NodeFlow en el WABA propio
// de NodeFlow (número compartido, Fase 1). El equivalente para 360dialog
// vive en routes-whatsapp-connect.js (submitTemplates); esto es para
// el número Meta directo.
//
// Uso:
//   WA_ACCESS_TOKEN=EAAG... WA_BUSINESS_ACCOUNT_ID=1234567890 \
//     node scripts/wa-submit-templates.js
//
//   (En Windows PowerShell:)
//   $env:WA_ACCESS_TOKEN="EAAG..."; $env:WA_BUSINESS_ACCOUNT_ID="123..."
//   node scripts/wa-submit-templates.js
//
// El token NUNCA se hardcodea: se lee de la variable de entorno.
// Los secretos se ponen en EasyPanel, no en el repo.
//
// La aprobación de Meta tarda ~1-24h. Reejecutar es idempotente:
// si la plantilla ya existe, Meta responde error "already exists" (se ignora).
// ============================================================

'use strict';

const https = require('https');

const TOKEN   = process.env.WA_ACCESS_TOKEN;
const WABA_ID = process.env.WA_BUSINESS_ACCOUNT_ID;
const API_VER = process.env.META_API_VERSION || 'v19.0';

if (!TOKEN || !WABA_ID) {
  console.error('✖ Faltan variables. Necesitas:');
  console.error('  WA_ACCESS_TOKEN         (token permanente de sistema de Meta)');
  console.error('  WA_BUSINESS_ACCOUNT_ID  (WABA id — WhatsApp Manager → Configuración)');
  console.error('\nEjemplo (PowerShell) — usa TUS valores reales, no estos:');
  console.error('  $env:WA_ACCESS_TOKEN="EAAG..."; $env:WA_BUSINESS_ACCOUNT_ID="123..."');
  console.error('  node scripts/wa-submit-templates.js');
  process.exit(1);
}

// Validación: detectar placeholders pegados por error (< >, espacios, puntos suspensivos)
const looksLikePlaceholder = (s) => /[<>\s]/.test(s) || /\.\.\./.test(s) || /real|tu |token permanente/i.test(s);
if (looksLikePlaceholder(TOKEN) || looksLikePlaceholder(WABA_ID)) {
  console.error('✖ Parece que pegaste un texto de EJEMPLO, no tus valores reales.');
  console.error(`    WA_ACCESS_TOKEN        = "${TOKEN.slice(0, 12)}..."`);
  console.error(`    WA_BUSINESS_ACCOUNT_ID = "${WABA_ID}"`);
  console.error('\n  Deben ser tus valores de Meta:');
  console.error('    · WA_BUSINESS_ACCOUNT_ID = un número largo, p.ej. 102938475610293 (sin < > ni espacios)');
  console.error('    · WA_ACCESS_TOKEN        = empieza por "EAA..." (token largo)');
  console.error('  Los encuentras en developers.facebook.com → tu App → WhatsApp → Configuración de la API.');
  process.exit(1);
}
if (!/^\d+$/.test(WABA_ID)) {
  console.error(`✖ WA_BUSINESS_ACCOUNT_ID debe ser solo dígitos. Recibido: "${WABA_ID}"`);
  process.exit(1);
}

// ── Las 3 plantillas de NodeFlow (categoría UTILITY) ────────────────────────
const TEMPLATES = [
  {
    name: 'nodeflow_cita_confirmada',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, tu cita en {{2}} ha sido confirmada para el {{3}} a las {{4}}. Servicio: {{5}}.',
        example: { body_text: [['María', 'Clínica Osakin', '5 de julio', '10:00', 'Fisioterapia']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Sistema de citas inteligente' },
    ],
  },
  {
    name: 'nodeflow_cita_recordatorio',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, te recordamos tu cita en {{2}} mañana {{3}} a las {{4}}. Servicio: {{5}}.',
        example: { body_text: [['María', 'Clínica Osakin', '5 de julio', '10:00', 'Fisioterapia']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'CONFIRMAR' },
          { type: 'QUICK_REPLY', text: 'CANCELAR' },
        ],
      },
    ],
  },
  {
    name: 'nodeflow_resena',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '¡Hola {{1}}! ¿Qué tal tu experiencia en {{2}}? Tu opinión nos ayuda mucho. Déjanos una reseña, solo te llevará un momento.',
        example: { body_text: [['María', 'Clínica Osakin']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Dejar reseña', url: 'https://g.page/r/{{1}}', example: ['example/review'] },
        ],
      },
    ],
  },
];

function submit(tpl) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(tpl);
    const options = {
      hostname: 'graph.facebook.com',
      path: `/${API_VER}/${WABA_ID}/message_templates`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch {}
        if (res.statusCode === 200 && json.id) {
          console.log(`  ✅ ${tpl.name} → creada (id ${json.id}, estado: ${json.status || 'PENDING'})`);
        } else if (/already exists/i.test(json?.error?.message || '')) {
          console.log(`  ⏭  ${tpl.name} → ya existía (ok)`);
        } else {
          console.log(`  ⚠️  ${tpl.name} → HTTP ${res.statusCode}: ${json?.error?.message || data}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => { console.log(`  ⚠️  ${tpl.name} → ${e.message}`); resolve(); });
    req.write(payload);
    req.end();
  });
}

(async () => {
  console.log(`▶ Dando de alta ${TEMPLATES.length} plantillas en WABA ${WABA_ID} (${API_VER})\n`);
  for (const tpl of TEMPLATES) await submit(tpl);
  console.log('\n✔ Hecho. Meta revisa las plantillas en ~1-24h.');
  console.log('  Estado: WhatsApp Manager → Herramientas de mensajes → Plantillas.');
})();
