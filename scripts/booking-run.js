#!/usr/bin/env node
// ============================================================
// NodeFlow — Runner de integraciones (RPA) para probar recetas en vivo.
//
// Por SEGURIDAD el modo por defecto es DRY-RUN: rellena el formulario y
// hace captura, pero NO pulsa "enviar/guardar" (no crea cita real en la
// DGT / agenda). Para enviar de verdad: --live.
//
// Uso:
//   npm i playwright && npx playwright install chromium      (una vez, en el worker)
//   node scripts/booking-run.js --recipe stormplus --headed             (dry-run visible)
//   node scripts/booking-run.js --recipe stormplus --config datos.json  (tus datos)
//   node scripts/booking-run.js --recipe organizate --live              (envía de verdad)
//
// Las capturas se guardan en el directorio de evidencia (se imprime la ruta).
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { bookAppointment } = require('../src/integrations/booking-service');

function flag(name) { return process.argv.includes(name); }
function opt(name, def) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

if (flag('--help') || flag('-h')) {
  console.log(`
NodeFlow — Runner de integraciones (RPA). DRY-RUN por defecto (no envía).

  node scripts/booking-run.js --recipe <stormplus|organizate> [opciones]

Opciones:
  --recipe <id>      Receta a ejecutar (por defecto: stormplus)
  --config <file>    JSON con { org, appt, patient } (si no, usa datos de ejemplo)
  --headed           Mostrar el navegador (ver lo que hace)
  --live             ENVIAR de verdad la cita (¡crea cita real!). Por defecto NO.
  --help

Requiere (en el worker):  npm i playwright && npx playwright install chromium
`);
  process.exit(0);
}

const recipeId   = opt('--recipe', 'stormplus');
const live       = flag('--live');
const headed     = flag('--headed');
const configPath = opt('--config', null);

const recipePath = path.join(__dirname, '..', 'src', 'integrations', 'recipes', `${recipeId}.json`);
if (!fs.existsSync(recipePath)) {
  console.error(`✖ No existe la receta '${recipeId}'. Disponibles: ${fs.readdirSync(path.dirname(recipePath)).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).join(', ')}`);
  process.exit(1);
}
const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));

// Datos de ejemplo (FICTICIOS, solo para dry-run). En --live usa --config con datos reales.
const SAMPLES = {
  stormplus: {
    org: { id: 'osakin', name: 'Osakin', stormPublicUrl: 'https://stormplus.lndeter.es/citapreviaonline/osakin' },
    appt: { provincia: 'GIPUZKOA', centro: 'CRC OSAKIN TOLOSA', tipoTramite: 'Renovación', tipoPermiso: 'B', dayNum: '2', time: '10:00' },
    patient: { dni: '00000000T', nombre: 'PRUEBA', apellido1: 'TEST', apellido2: 'NODEFLOW', email: 'prueba@nodeflow.es', phone: '600000000' },
  },
  organizate: {
    org: { id: 'osakin', name: 'Osakin', organizateLoginUrl: 'https://www.organizate.info/', organizateUser: 'TODO', organizatePass: 'TODO' },
    appt: { sede: 'Tolosa', service: 'Fisioterapia', profesional: '', date: '15/07/2026', time: '10:00', notas: 'Cita de prueba NodeFlow' },
    patient: { name: 'PRUEBA TEST', phone: '600000000', email: 'prueba@nodeflow.es' },
  },
};

const data = configPath && configPath !== true
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : SAMPLES[recipeId];

if (!data) { console.error(`✖ Sin datos para '${recipeId}'. Pasa --config datos.json`); process.exit(1); }

(async () => {
  console.log(`\n▶ Receta: ${recipe.id} — ${recipe.name}`);
  console.log(`  Modo: ${live ? '🔴 LIVE (ENVÍA la cita)' : '🟢 DRY-RUN (rellena pero NO envía)'} · navegador ${headed ? 'visible' : 'headless'}\n`);
  if (live) console.log('  ⚠️  --live creará una cita REAL. Asegúrate de que los datos son correctos.\n');

  const res = await bookAppointment({
    recipe,
    org: data.org, appt: data.appt, patient: data.patient,
    headless: !headed,
    dryRun: !live,
    notify: async (e) => console.log(`  · notify → ${e.type}${e.reason ? ' (' + e.reason + ')' : ''}`),
  });

  console.log('\n── Resultado ──');
  console.log(JSON.stringify({ ok: res.ok, dryRun: res.dryRun, fallback: res.fallback, ref: res.ref, error: res.error }, null, 2));
  if (res.evidence && res.evidence.length) {
    console.log('\nCapturas de evidencia:');
    res.evidence.forEach(e => console.log(`  • ${e.name} → ${e.ref}`));
  }
  console.log(res.ok ? '\n✅ OK\n' : '\n✖ Falló (revisa la captura y ajusta los selectores de la receta)\n');
  process.exit(res.ok ? 0 : 1);
})().catch(e => {
  console.error('\n✖', e.message);
  if (/playwright/i.test(e.message)) console.error('  → Instala: npm i playwright && npx playwright install chromium');
  process.exit(1);
});
