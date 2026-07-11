#!/usr/bin/env node
// ============================================================
// NodeFlow — Verificar el ESTADO de las plantillas WhatsApp en Meta
//
// Solo LECTURA: consulta la Graph API (GET message_templates) y lista cada
// plantilla con su estado (APPROVED / PENDING / REJECTED). Compara con las que
// NodeFlow define (WA_TEMPLATES) para señalar cuáles faltan por dar de alta.
// No modifica nada. Pensado para responder "¿está aprobada nodeflow_cita_recordatorio?".
//
// Uso (PowerShell):
//   $env:WA_ACCESS_TOKEN="EAAG..."; $env:WA_BUSINESS_ACCOUNT_ID="123..."
//   node scripts/wa-check-templates.js
//
// El token NUNCA se hardcodea: se lee de la variable de entorno.
// Los mismos valores que usa scripts/wa-submit-templates.js.
// ============================================================

'use strict';

const https = require('https');

const TOKEN   = process.env.WA_ACCESS_TOKEN;
const WABA_ID = process.env.WA_BUSINESS_ACCOUNT_ID;
const API_VER = process.env.META_API_VERSION || 'v19.0';

if (!TOKEN || !WABA_ID) {
  console.error('✖ Faltan variables. Necesitas:');
  console.error('  WA_ACCESS_TOKEN         (token de Meta, empieza por EAA...)');
  console.error('  WA_BUSINESS_ACCOUNT_ID  (WABA id — solo dígitos)');
  console.error('\nEjemplo (PowerShell):');
  console.error('  $env:WA_ACCESS_TOKEN="EAAG..."; $env:WA_BUSINESS_ACCOUNT_ID="123..."');
  console.error('  node scripts/wa-check-templates.js');
  process.exit(1);
}
const looksLikePlaceholder = (s) => /[<>\s]/.test(s) || /\.\.\./.test(s) || /real|tu |token permanente/i.test(s);
if (looksLikePlaceholder(TOKEN) || looksLikePlaceholder(WABA_ID) || !/^\d+$/.test(WABA_ID)) {
  console.error('✖ Parece que pegaste un valor de ejemplo. WA_BUSINESS_ACCOUNT_ID = solo dígitos; WA_ACCESS_TOKEN = EAA...');
  process.exit(1);
}

const { WA_TEMPLATES } = require('../src/whatsapp/templates');
const OURS = new Set(WA_TEMPLATES.map(t => t.name));

function getPage(after) {
  return new Promise((resolve, reject) => {
    let path = `/${API_VER}/${WABA_ID}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`;
    if (after) path += `&after=${encodeURIComponent(after)}`;
    const req = https.request({
      hostname: 'graph.facebook.com', path, method: 'GET',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    }, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch (_) {}
        if (res.statusCode !== 200) return reject(new Error(json?.error?.message || `HTTP ${res.statusCode}: ${data}`));
        resolve(json);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const ICON = { APPROVED: '✅', PENDING: '⏳', REJECTED: '❌', PAUSED: '⏸', DISABLED: '🚫' };

(async () => {
  try {
    console.log(`▶ Estado de plantillas en WABA ${WABA_ID} (${API_VER})\n`);
    const rows = [];
    let after = null;
    do {
      const page = await getPage(after);
      for (const t of (page.data || [])) rows.push(t);
      after = page.paging?.cursors?.after && page.data?.length ? page.paging.cursors.after : null;
    } while (after);

    const byName = new Map();
    for (const t of rows) {
      // Una plantilla puede tener varias filas (idiomas): guarda la "mejor" (APPROVED gana).
      const prev = byName.get(t.name);
      if (!prev || (prev.status !== 'APPROVED' && t.status === 'APPROVED')) byName.set(t.name, t);
    }

    // Todas las que Meta conoce
    for (const t of [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const mark = OURS.has(t.name) ? '' : '  (ajena a NodeFlow)';
      const rej  = t.status === 'REJECTED' && t.rejected_reason ? ` — motivo: ${t.rejected_reason}` : '';
      console.log(`  ${ICON[t.status] || '•'} ${t.name.padEnd(32)} ${String(t.status).padEnd(9)} ${t.category || ''}${rej}${mark}`);
    }

    // Las nuestras que Meta NO conoce todavía (sin dar de alta)
    const missing = [...OURS].filter(n => !byName.has(n)).sort();
    if (missing.length) {
      console.log(`\n⚠️  Definidas en NodeFlow pero SIN dar de alta en Meta (${missing.length}):`);
      for (const n of missing) console.log(`     ${n}   → ejecuta scripts/wa-submit-templates.js`);
    }

    // Foco en la de Fase 3
    const cita = byName.get('nodeflow_cita_recordatorio');
    console.log('\n── Fase 3 · nodeflow_cita_recordatorio (botones CONFIRMAR/CANCELAR) ──');
    if (!cita) {
      console.log('  ❌ NO dada de alta en Meta. Ejecuta scripts/wa-submit-templates.js y espera la aprobación (~1-24h).');
    } else if (cita.status === 'APPROVED') {
      console.log('  ✅ APROBADA — el recordatorio de cita con botones ya se puede enviar.');
    } else {
      console.log(`  ${ICON[cita.status] || '•'} ${cita.status}${cita.rejected_reason ? ' — ' + cita.rejected_reason : ''} (aún no enviable con botones).`);
    }
  } catch (e) {
    console.error(`\n✖ Error consultando Meta: ${e.message}`);
    process.exit(1);
  }
})();
