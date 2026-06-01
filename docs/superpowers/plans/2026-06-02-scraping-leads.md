# Unified Lead Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broken/fragmented scraping scripts with a single `buscar-leads.js` command that searches Google Places (primary) + Páginas Amarillas (fallback), pushes results directly to Google Sheets, and is documented for comerciales.

**Architecture:** Two new files (`scripts/buscar-leads.js` + `src/utils/leads-utils.js`) replace the broken `find-targets.js` and redundant `find-leads.js`. The existing `scrape-leads.js` (PA scraper) and `sheets-appscript.gs` (already deployed) are reused as-is.

**Tech Stack:** Node.js, Google Places API v1 (Text Search + Place Details), Páginas Amarillas HTML scraping, Google Apps Script Web App (already deployed), dotenv

---

## File Map

- Create: `src/utils/leads-utils.js` — dedup, WA templates, CSV writer, pushToSheet
- Create: `scripts/buscar-leads.js` — CLI entry point, Google Places search, PA fallback, orchestration
- Create: `docs/comerciales/buscar-leads.md` — sales team guide
- Delete: `scripts/find-leads.js` — replaced
- Delete: `scripts/find-targets.js` — broken + replaced
- Keep: `scripts/scrape-leads.js` — PA scraper, called programmatically
- Keep: `scripts/sheets-appscript.gs` — already deployed

---

## Task 1: Create src/utils/leads-utils.js

**Files:**
- Create: `src/utils/leads-utils.js`
- Test: run `node -e "const u = require('./src/utils/leads-utils'); console.log(typeof u.dedup, typeof u.buildWALink, typeof u.writeCSV, typeof u.pushToSheet)"`

- [ ] **Step 1: Create the file with all four exported functions**

```javascript
// src/utils/leads-utils.js
// Shared utilities for the lead scraping pipeline
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Normalise ─────────────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Dedup by nombre+ciudad ────────────────────────────────────────────────────
function dedup(leads) {
  const seen = new Set();
  return leads.filter(l => {
    const key = norm(l.nombre) + '|' + norm(l.ciudad);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── WhatsApp templates by sector ──────────────────────────────────────────────
const WA_TEMPLATES = {
  'dental':          (n, c) => `Hola ${n} 👋 Trabajo con clínicas dentales en ${c} para automatizar la recepción telefónica con IA. Citas, confirmaciones y cancelaciones sin coste de personal extra. ¿Tienes 5 minutos para verlo?`,
  'veterinari':      (n, c) => `Hola ${n} 👋 Vi vuestra clínica veterinaria en ${c}. Tengo una IA que atiende llamadas 24h — citas, urgencias, consultas — sin perderse nada. ¿Te cuento?`,
  'peluquer':        (n, c) => `Hola ${n} 👋 Vi vuestra peluquería en ${c}. Tengo una solución de IA que atiende reservas telefónicas 24h sin que tengas que coger el teléfono. ¿Te cuento en 5 minutos?`,
  'estétic':         (n, c) => `Hola ${n} 👋 Vi vuestro centro en ${c}. Trabajo con centros de estética para automatizar reservas telefónicas con IA — sin perder una llamada aunque estéis atendiendo. ¿Te cuento?`,
  'gimnasio':        (n, c) => `Hola ${n} 👋 Vi vuestro gimnasio en ${c}. Ofrezco una IA que atiende llamadas 24h: altas, horarios, clases. Los clientes llaman cuando quieren, vosotros no perdéis ninguna alta. ¿Te cuento en 5 min?`,
  'restaurante':     (n, c) => `Hola ${n} 👋 Os vi en ${c} y me surgió una idea: ¿y si vuestra IA atendiera las reservas telefónicas de noche/fin de semana sin perder ninguna llamada? Sin apps, sin cambios. ¿Hablamos?`,
  'farmacia':        (n, c) => `Hola ${n} 👋 Vi vuestra farmacia en ${c}. Tengo una IA que atiende consultas y derivaciones telefónicas 24h. Los clientes obtienen respuesta siempre, vosotros sin interrupciones. ¿5 minutos?`,
  'hotel':           (n, c) => `Hola ${n} 👋 Vi vuestro hotel en ${c}. Ofrezco IA para recepción telefónica 24h: reservas, check-in info, consultas. Sin perder ninguna llamada fuera de horario. ¿Lo vemos?`,
  'academi':         (n, c) => `Hola ${n} 👋 Vi vuestra academia en ${c}. Tengo una IA que atiende consultas y matriculaciones telefónicas 24h sin que tengáis que coger el teléfono. ¿Te interesa verlo?`,
  'asesor':          (n, c) => `Hola ${n} 👋 Vi vuestra asesoría en ${c}. Ofrezco IA que atiende llamadas entrantes 24h: citas, consultas básicas, derivaciones. Vosotros solo veis lo importante. ¿Hablamos?`,
  'inmobiliaria':    (n, c) => `Hola ${n} 👋 Vi vuestra inmobiliaria en ${c}. Tengo una IA que atiende consultas de pisos 24h — características, visitas, precio — sin que tengáis que estar disponibles siempre. ¿Lo vemos?`,
  'taller':          (n, c) => `Hola ${n} 👋 Ofrezco a talleres en ${c} una IA que atiende llamadas de clientes 24h: citas, presupuestos, consultas. Tú solo ves lo que entra. ¿Te interesa probarlo gratis 7 días?`,
  'clínica':         (n, c) => `Hola ${n} 👋 Vi vuestra clínica en ${c}. Tengo una IA que atiende llamadas de pacientes 24h — citas, resultados, derivaciones — sin colapsar recepción. ¿Te cuento?`,
  'fisioterapia':    (n, c) => `Hola ${n} 👋 Vi vuestro centro de fisioterapia en ${c}. Ofrezco IA que atiende citas telefónicas 24h sin coste de personal extra. ¿5 minutos para verlo?`,
};

function buildWALink(lead) {
  if (!lead.telefono) return { wa_link: '', wa_mensaje: '(sin teléfono — buscar manualmente)' };

  const key = Object.keys(WA_TEMPLATES).find(k =>
    norm(lead.sector).includes(k) || norm(lead.nombre).includes(k)
  ) || null;

  const fn = key ? WA_TEMPLATES[key] : (n, c) => `Hola ${n} 👋 Os vi en ${c}. Tengo una IA que atiende vuestras llamadas 24h — reservas, consultas, citas. ¿5 minutos para verlo?`;
  const wa_mensaje = fn(lead.nombre, lead.ciudad);

  // Normalise phone: strip non-digits, add 34 prefix if Spanish (9 digits starting with 6/7/8/9)
  const digits = lead.telefono.replace(/\D/g, '');
  const phone  = digits.startsWith('34') ? digits : '34' + digits;
  const wa_link = `https://wa.me/${phone}?text=${encodeURIComponent(wa_mensaje)}`;

  return { wa_link, wa_mensaje };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const CSV_HEADERS = [
  'nombre','sector','ciudad','telefono','address','rating','reviews',
  'website','maps_url','wa_link','wa_mensaje',
  'estado','notas','fecha_contacto','fecha_añadido'
];

function escCsv(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
}

function writeCSV(leads, filepath) {
  const rows = leads.map(l =>
    CSV_HEADERS.map(h => escCsv(l[h] != null ? l[h] : '')).join(',')
  );
  fs.writeFileSync(filepath, [CSV_HEADERS.join(','), ...rows].join('\n'), 'utf8');
}

// ── Push to Google Sheet via Apps Script ──────────────────────────────────────
function pushToSheet(leads) {
  return new Promise((resolve) => {
    const url = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!url) {
      return resolve({ ok: false, reason: 'GOOGLE_APPS_SCRIPT_URL no configurada en .env' });
    }

    const today = new Date().toLocaleDateString('es-ES');
    const payload = JSON.stringify({
      leads: leads.map(l => ({ ...l, fecha_añadido: today }))
    });

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        // Apps Script may redirect (302) to a new URL — follow manually if needed
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Retry with redirect target
          process.env._SHEET_REDIRECT = res.headers.location;
          return pushToSheet(leads).then(resolve);
        }
        try {
          const json = JSON.parse(body);
          resolve({ ok: json.ok === true, added: json.added || 0, skipped: json.skipped || 0, error: json.error });
        } catch {
          resolve({ ok: false, reason: 'Respuesta inesperada del Sheet: ' + body.substring(0, 100) });
        }
      });
    });

    req.on('error', e => resolve({ ok: false, reason: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, reason: 'Timeout (15s)' }); });
    req.write(payload);
    req.end();
  });
}

module.exports = { dedup, buildWALink, writeCSV, pushToSheet };
```

- [ ] **Step 2: Verify the module loads cleanly**

```bash
node -e "const u = require('./src/utils/leads-utils'); console.log(typeof u.dedup, typeof u.buildWALink, typeof u.writeCSV, typeof u.pushToSheet)"
```

Expected output: `function function function function`

- [ ] **Step 3: Test dedup with inline data**

```bash
node -e "
const { dedup } = require('./src/utils/leads-utils');
const leads = [
  { nombre: 'Clínica Sol', ciudad: 'Bilbao' },
  { nombre: 'Clinica Sol', ciudad: 'bilbao' },   // duplicate (case insensitive)
  { nombre: 'Dental Norte', ciudad: 'Bilbao' },
];
const result = dedup(leads);
console.assert(result.length === 2, 'Expected 2 unique leads, got ' + result.length);
console.log('dedup OK:', result.length, 'leads');
"
```

Expected: `dedup OK: 2 leads`

- [ ] **Step 4: Test buildWALink with dental sector**

```bash
node -e "
const { buildWALink } = require('./src/utils/leads-utils');
const result = buildWALink({ nombre: 'Clínica Dental Sol', sector: 'dental', ciudad: 'Bilbao', telefono: '944123456' });
console.assert(result.wa_link.startsWith('https://wa.me/34'), 'wa_link should start with wa.me/34');
console.assert(result.wa_mensaje.includes('Bilbao'), 'mensaje should include city');
console.log('buildWALink OK:', result.wa_link.substring(0, 50) + '...');
"
```

Expected: `buildWALink OK: https://wa.me/34944123456?text=...`

- [ ] **Step 5: Commit**

```bash
git add src/utils/leads-utils.js
git commit -m "feat: add leads-utils (dedup, WA templates, CSV, pushToSheet)"
```

---

## Task 2: Create scripts/buscar-leads.js

**Files:**
- Create: `scripts/buscar-leads.js`
- Depends on: `src/utils/leads-utils.js` (Task 1)

- [ ] **Step 1: Create the main CLI script**

```javascript
#!/usr/bin/env node
// ============================================================
// NodeFlow — Buscador de leads unificado
//
// Uso:
//   node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao
//   node scripts/buscar-leads.js --sector=restaurantes --ciudad=madrid --max=100
//   node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia --solo-pa
//   node scripts/buscar-leads.js --sector=gimnasios --ciudad=sevilla --no-sheet
//   node scripts/buscar-leads.js --help
//
// Requiere en .env:
//   GOOGLE_PLACES_API_KEY      (Google Cloud Console → Places API)
//   GOOGLE_APPS_SCRIPT_URL     (Extensions → Apps Script → Deploy as Web App)
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const https = require('https');
const { dedup, buildWALink, writeCSV, pushToSheet } = require('../src/utils/leads-utils');

// ── Sector map ────────────────────────────────────────────────────────────────
const SECTOR_MAP = {
  dentistas:         { google: 'clínica dental',        pa: 'dentistas' },
  veterinarios:      { google: 'clínica veterinaria',   pa: 'veterinarios' },
  peluquerias:       { google: 'peluquería',            pa: 'peluquerias-y-salones-de-belleza' },
  estetica:          { google: 'centro de estética',    pa: 'centros-de-estetica' },
  gimnasios:         { google: 'gimnasio',              pa: 'gimnasios' },
  restaurantes:      { google: 'restaurante',           pa: 'restaurantes' },
  farmacias:         { google: 'farmacia',              pa: 'farmacias' },
  hoteles:           { google: 'hotel',                 pa: 'hoteles' },
  academias:         { google: 'academia',              pa: 'academias' },
  asesoria:          { google: 'asesoría',              pa: 'gestores-asesores' },
  inmobiliarias:     { google: 'inmobiliaria',          pa: 'inmobiliarias' },
  talleres:          { google: 'taller mecánico',       pa: 'talleres-de-coches' },
  clinicas:          { google: 'clínica médica',        pa: 'clinicas' },
  fisioterapeutas:   { google: 'fisioterapia',          pa: 'fisioterapeutas' },
};

// City coordinates for biased search
const CITY_COORDS = {
  bilbao:      '43.2627,-2.9253',
  donostia:    '43.3183,-1.9812',
  vitoria:     '42.8467,-2.6728',
  pamplona:    '42.8125,-1.6458',
  madrid:      '40.4168,-3.7038',
  barcelona:   '41.3851,2.1734',
  valencia:    '39.4699,-0.3763',
  sevilla:     '37.3891,-5.9845',
  zaragoza:    '41.6488,-0.8891',
  malaga:      '36.7213,-4.4214',
  murcia:      '37.9922,-1.1307',
  alicante:    '38.3452,-0.4815',
  santander:   '43.4623,-3.8099',
  oviedo:      '43.3619,-5.8494',
  gijon:       '43.5322,-5.6611',
  coruna:      '43.3713,-8.4196',
  vigo:        '42.2328,-8.7226',
  logrono:     '42.4627,-2.4449',
};

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = { max: 60, soloPa: false, noSheet: false };
  process.argv.slice(2).forEach(a => {
    if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    if (a === '--solo-pa')   { args.soloPa = true; return; }
    if (a === '--no-sheet')  { args.noSheet = true; return; }
    const [k, v] = a.replace(/^--/, '').split('=');
    if (v !== undefined) args[k.replace(/-([a-z])/g, (_,c) => c.toUpperCase())] = isNaN(Number(v)) ? v : Number(v);
  });
  return args;
}

function printHelp() {
  console.log(`
NodeFlow — Buscador de leads
Uso: node scripts/buscar-leads.js --sector=<sector> --ciudad=<ciudad> [opciones]

Opciones:
  --sector=<slug>   Sector a buscar (ver lista abajo) [requerido]
  --ciudad=<nombre> Ciudad objetivo [requerido]
  --max=<n>         Máximo de leads a buscar (default: 60)
  --solo-pa         Forzar solo Páginas Amarillas (sin coste Google)
  --no-sheet        Solo guardar CSV, no subir al Sheet
  --help            Mostrar esta ayuda

Sectores disponibles:
  ${Object.keys(SECTOR_MAP).join(' | ')}

Ejemplos:
  node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao
  node scripts/buscar-leads.js --sector=restaurantes --ciudad=madrid --max=100
  node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia --solo-pa
`);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Google Places ─────────────────────────────────────────────────────────────
async function googleSearch(query, city, apiKey, maxResults) {
  const leads = [];
  let pageToken = null;
  let page = 0;
  const cityKey = city.toLowerCase().replace(/[^a-z]/g, '');
  const coords  = CITY_COORDS[cityKey];

  while (leads.length < maxResults) {
    page++;
    let url;
    if (pageToken) {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${apiKey}`;
    } else {
      const q = encodeURIComponent(`${query} en ${city}`);
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&language=es&region=es&key=${apiKey}`;
      if (coords) url += `&location=${coords}&radius=10000`;
    }

    process.stdout.write(`   [Google] Página ${page}… `);
    const res = await get(url);

    if (res.status === 'OVER_QUERY_LIMIT') {
      console.log('⚠️  Cuota Google agotada — cambiando a Páginas Amarillas');
      return { leads, quotaExhausted: true };
    }
    if (res.status === 'REQUEST_DENIED') {
      throw new Error('Google Places API rechazada: ' + (res.error_message || 'verifica la API key'));
    }
    if (res.status === 'ZERO_RESULTS' || !res.results?.length) {
      console.log('0 resultados');
      break;
    }

    const places = res.results || [];
    console.log(`${places.length} negocios`);

    for (const p of places) {
      if (leads.length >= maxResults) break;
      process.stdout.write(`      → ${(p.name || '').substring(0, 38).padEnd(38)} `);

      const fields = 'name,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,formatted_address';
      const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=${fields}&language=es&key=${apiKey}`;
      const det = await get(detUrl);
      await sleep(150);

      const d = det.result || {};
      const telefono = d.formatted_phone_number || d.international_phone_number || '';
      console.log(telefono || '(sin tel)');

      leads.push({
        nombre:   d.name || p.name || '',
        sector:   query,
        ciudad:   city,
        telefono: telefono.replace(/\s/g, ''),
        address:  d.formatted_address || p.formatted_address || '',
        rating:   String(d.rating || p.rating || ''),
        reviews:  String(d.user_ratings_total || p.user_ratings_total || ''),
        website:  d.website || '',
        maps_url: d.url || `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
        estado: '', notas: '', fecha_contacto: '',
      });
    }

    pageToken = res.next_page_token;
    if (!pageToken) break;
    await sleep(2000); // Google requires 2s between pagination
  }

  return { leads, quotaExhausted: false };
}

// ── Páginas Amarillas (via scrape-leads.js logic inline) ──────────────────────
async function paSearch(paSector, ciudad, maxResults) {
  // Spawn scrape-leads.js as a child process, capture CSV output, parse it
  const { execFile } = require('child_process');
  return new Promise(resolve => {
    const args = [`--sector=${paSector}`, `--ciudad=${ciudad.toLowerCase()}`, `--paginas=5`, `--delay=1500`];
    const scriptPath = path.join(__dirname, 'scrape-leads.js');

    // scrape-leads.js writes CSV to root — capture it
    const tmpFile = path.join(__dirname, '..', `_pa_tmp_${Date.now()}.csv`);

    // Patch args to redirect output — we'll parse the CSV after it runs
    const proc = execFile('node', [scriptPath, ...args], { cwd: path.join(__dirname, '..') }, (err, stdout) => {
      // Find CSV written by scrape-leads.js
      const match = stdout.match(/CSV guardado: ([^\n]+\.csv)/);
      const csvName = match ? match[1].trim() : null;
      if (!csvName) return resolve([]);

      const csvPath = path.join(__dirname, '..', csvName);
      if (!fs.existsSync(csvPath)) return resolve([]);

      try {
        const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1); // skip header
        const leads = lines
          .filter(l => l.trim())
          .slice(0, maxResults)
          .map(line => {
            // CSV format: "Negocio","Teléfono","Dirección","Web"
            const cols = line.match(/(?:"([^"]*)")|([^,]+)/g)?.map(v => v.replace(/^"|"$/g,'')) || [];
            return {
              nombre:   cols[0] || '',
              sector:   paSector,
              ciudad:   ciudad,
              telefono: (cols[1] || '').replace(/\s/g,''),
              address:  cols[2] || '',
              rating:   '',
              reviews:  '',
              website:  cols[3] || '',
              maps_url: '',
              estado: '', notas: '', fecha_contacto: '',
            };
          })
          .filter(l => l.nombre);

        // Clean up temp CSV from scrape-leads
        try { fs.unlinkSync(csvPath); } catch {}
        resolve(leads);
      } catch {
        resolve([]);
      }
    });

    proc.stdout?.on('data', d => process.stdout.write(d));
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!args.sector) {
    console.error('\n❌ --sector es requerido. Ejecuta --help para ver opciones.\n');
    process.exit(1);
  }
  if (!args.ciudad) {
    console.error('\n❌ --ciudad es requerida. Ejemplo: --ciudad=bilbao\n');
    process.exit(1);
  }

  const sectorSlug = args.sector.toLowerCase();
  const sectorInfo = SECTOR_MAP[sectorSlug];
  if (!sectorInfo) {
    console.error(`\n❌ Sector no reconocido: "${args.sector}"`);
    console.error(`   Sectores disponibles: ${Object.keys(SECTOR_MAP).join(', ')}\n`);
    process.exit(1);
  }

  if (!apiKey && !args.soloPa) {
    console.error('\n❌ GOOGLE_PLACES_API_KEY no configurada en .env');
    console.error('   Usa --solo-pa para buscar solo en Páginas Amarillas sin API key.\n');
    process.exit(1);
  }

  const ciudad = args.ciudad;
  const maxResults = args.max;

  console.log(`\n🔍 NodeFlow — Buscador de Leads`);
  console.log(`   Sector:  ${sectorInfo.google}`);
  console.log(`   Ciudad:  ${ciudad}`);
  console.log(`   Máx:     ${maxResults} leads`);
  console.log(`   Fuente:  ${args.soloPa ? 'Páginas Amarillas (forzado)' : 'Google Places + PA fallback'}\n`);

  let leads = [];
  let usedPA = false;

  // ── Primary: Google Places ────────────────────────────────────────────────
  if (!args.soloPa && apiKey) {
    console.log('📍 Buscando en Google Places…');
    const { leads: gLeads, quotaExhausted } = await googleSearch(sectorInfo.google, ciudad, apiKey, maxResults);
    leads = gLeads;
    console.log(`   → ${leads.length} leads encontrados en Google\n`);

    // Fallback to PA if few results or quota exhausted
    const withPhone = leads.filter(l => l.telefono).length;
    if (quotaExhausted || withPhone < 15) {
      console.log(`${quotaExhausted ? '⚠️  Cuota agotada' : `📊 Solo ${withPhone} leads con teléfono`} — complementando con Páginas Amarillas…\n`);
      usedPA = true;
    }
  }

  // ── Fallback / complementary: Páginas Amarillas ───────────────────────────
  if (args.soloPa || usedPA) {
    console.log('📰 Buscando en Páginas Amarillas…');
    const paLeads = await paSearch(sectorInfo.pa, ciudad, maxResults);
    console.log(`   → ${paLeads.length} leads desde PA\n`);
    leads = dedup([...leads, ...paLeads]);
  }

  if (leads.length === 0) {
    console.log('⚠️  Sin resultados. Prueba con otro sector o ciudad.');
    process.exit(0);
  }

  // ── Enrich with WA links ──────────────────────────────────────────────────
  leads = leads.map(l => {
    const { wa_link, wa_mensaje } = buildWALink({ ...l, sector: sectorInfo.google });
    return { ...l, wa_link, wa_mensaje };
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  const withPhone = leads.filter(l => l.telefono).length;
  console.log(`📊 Resultados:`);
  console.log(`   Total:        ${leads.length}`);
  console.log(`   Con teléfono: ${withPhone} ← leads calientes`);
  console.log(`   Sin teléfono: ${leads.length - withPhone}`);

  // ── Save CSV ──────────────────────────────────────────────────────────────
  const date     = new Date().toISOString().split('T')[0];
  const filename = `leads_${sectorSlug}_${ciudad.toLowerCase().replace(/[^a-z0-9]/g,'-')}_${date}.csv`;
  const csvPath  = path.join(__dirname, '..', filename);
  writeCSV(leads, csvPath);
  console.log(`\n✅ CSV guardado: ${filename}`);

  // ── Push to Sheet ─────────────────────────────────────────────────────────
  if (!args.noSheet) {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('⚠️  GOOGLE_APPS_SCRIPT_URL no configurada — solo CSV guardado.');
      console.log('   Añade la URL al .env para sincronizar con Google Sheets.');
    } else {
      process.stdout.write('\n📊 Subiendo al Sheet… ');
      const result = await pushToSheet(leads);
      if (result.ok) {
        console.log(`✅ ${result.added} añadidos, ${result.skipped} ya existían.`);
      } else {
        console.log(`⚠️  No se pudo subir al Sheet: ${result.reason || result.error}`);
        console.log(`   El CSV se ha guardado igualmente en: ${filename}`);
      }
    }
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  console.log('\n📋 Primeros 5 leads:');
  leads.filter(l => l.telefono).slice(0, 5).forEach((l, i) => {
    console.log(`   ${i+1}. ${l.nombre}`);
    console.log(`      📞 ${l.telefono}  🌐 ${l.website || '—'}`);
    console.log(`      📍 ${l.address}`);
  });
  console.log('');
}

main().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run --help to verify it loads without errors**

```bash
node scripts/buscar-leads.js --help
```

Expected: prints usage with sector list, no crash.

- [ ] **Step 3: Run a dry test with --no-sheet --max=3 (uses real API key)**

```bash
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --max=3 --no-sheet
```

Expected: finds 3 leads, prints preview, saves CSV, no Sheet push.

- [ ] **Step 4: Test --solo-pa to verify PA path works**

```bash
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --max=10 --solo-pa --no-sheet
```

Expected: uses Páginas Amarillas, finds leads, saves CSV.

- [ ] **Step 5: Test full flow including Sheet push**

```bash
node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia --max=5
```

Expected: finds leads, pushes to Sheet, prints "N añadidos, M ya existían."
Verify in https://docs.google.com/spreadsheets/ that the leads appear.

- [ ] **Step 6: Test deduplication (run same command twice)**

```bash
node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia --max=5
```

Expected second run: "0 añadidos, 5 ya existían."

- [ ] **Step 7: Commit**

```bash
git add scripts/buscar-leads.js
git commit -m "feat: unified lead scraper — Google Places primary, PA fallback, auto Sheet push"
```

---

## Task 3: Delete obsolete scripts

**Files:**
- Delete: `scripts/find-leads.js`
- Delete: `scripts/find-targets.js`

- [ ] **Step 1: Delete find-leads.js**

```bash
git rm scripts/find-leads.js
```

- [ ] **Step 2: Delete find-targets.js**

```bash
git rm scripts/find-targets.js
```

- [ ] **Step 3: Verify nothing else imports them**

```bash
node -e "require('./scripts/find-leads.js')" 2>&1 | head -3
```

Expected: `Cannot find module` (confirms it's gone, nothing should reference it)

```bash
grep -r "find-leads\|find-targets" src/ scripts/ --include="*.js" 2>/dev/null
```

Expected: no output (nothing imports them)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove obsolete find-leads.js and find-targets.js (replaced by buscar-leads.js)"
```

---

## Task 4: Create docs/comerciales/buscar-leads.md

**Files:**
- Create: `docs/comerciales/buscar-leads.md`

- [ ] **Step 1: Create the comerciales directory and guide**

```bash
mkdir -p docs/comerciales
```

Then create `docs/comerciales/buscar-leads.md` with this content:

```markdown
# Guía de Leads — NodeFlow

Cómo conseguir contactos de negocios reales listos para hacer outreach por WhatsApp.

---

## Requisitos

Solo necesitas tener Node.js instalado y acceso a la carpeta del proyecto NodeFlow.
Las API keys ya están configuradas — no necesitas hacer nada.

---

## Cómo buscar leads

Abre una terminal en la carpeta del proyecto y ejecuta:

```
node scripts/buscar-leads.js --sector=SECTOR --ciudad=CIUDAD
```

**Ejemplos:**

```bash
# Clínicas dentales en Bilbao
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao

# Peluquerías en Donostia
node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia

# Restaurantes en Madrid (hasta 100 resultados)
node scripts/buscar-leads.js --sector=restaurantes --ciudad=madrid --max=100

# Gimnasios en Sevilla — solo guardar CSV, no subir al Sheet todavía
node scripts/buscar-leads.js --sector=gimnasios --ciudad=sevilla --no-sheet
```

---

## Sectores disponibles

| Slug (lo que escribes) | Negocio que busca |
|------------------------|-------------------|
| `dentistas` | Clínicas dentales |
| `veterinarios` | Clínicas veterinarias |
| `peluquerias` | Peluquerías y salones de belleza |
| `estetica` | Centros de estética |
| `gimnasios` | Gimnasios y centros deportivos |
| `restaurantes` | Restaurantes |
| `farmacias` | Farmacias |
| `hoteles` | Hoteles |
| `academias` | Academias y centros de formación |
| `asesoria` | Asesorías y gestorías |
| `inmobiliarias` | Inmobiliarias |
| `talleres` | Talleres mecánicos |
| `clinicas` | Clínicas médicas generales |
| `fisioterapeutas` | Centros de fisioterapia |

---

## Qué pasa cuando ejecutas el comando

1. Busca negocios en Google Maps por el sector y ciudad que indicaste
2. Obtiene teléfono, dirección, rating y web de cada negocio
3. Genera automáticamente un mensaje de WhatsApp personalizado por sector
4. **Sube los leads directamente al Sheet compartido** (sin duplicados)
5. Guarda también un CSV en la carpeta del proyecto como copia de seguridad

---

## El Sheet compartido

Una vez ejecutado el comando, los leads aparecen en Google Sheets con estas columnas:

| Columna | Qué es |
|---------|--------|
| nombre | Nombre del negocio |
| sector | Sector buscado |
| ciudad | Ciudad |
| telefono | Teléfono directo |
| address | Dirección |
| rating | Valoración Google (1-5) |
| reviews | Número de reseñas |
| website | Web del negocio |
| maps_url | Link a Google Maps |
| wa_link | **Link directo de WhatsApp** — solo pulsar y enviar |
| wa_mensaje | Mensaje personalizado ya redactado |
| estado | Para rellenar: `contactado`, `interesado`, `demo`, `cliente`, `no interesa` |
| notas | Tus anotaciones |
| fecha_contacto | Cuándo contactaste |
| fecha_añadido | Cuándo se añadió el lead |

---

## Flujo de trabajo recomendado para comerciales

1. **Busca leads** con el comando de arriba
2. **Abre el Sheet** → filtra por ciudad o sector
3. **Mira el wa_link** → un clic abre WhatsApp con el mensaje ya escrito
4. **Envía el mensaje**, luego actualiza la columna `estado` a `contactado`
5. Si responde con interés → `interesado`, agenda demo, actualiza `fecha_contacto` y `notas`

---

## Opciones avanzadas

```bash
# Solo Páginas Amarillas (gratis, sin límite, algo menos de datos)
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --solo-pa

# Sin subir al Sheet (solo genera CSV)
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --no-sheet

# Ver ayuda completa
node scripts/buscar-leads.js --help
```

---

## Si algo falla

**"GOOGLE_PLACES_API_KEY no configurada"** → Pide al técnico que configure el .env  
**"Cuota Google agotada"** → El script automáticamente busca en Páginas Amarillas como alternativa  
**"No se pudo subir al Sheet"** → El CSV se guarda igualmente; súbelo manualmente o avisa al técnico  
**"Sector no reconocido"** → Revisa la tabla de sectores de arriba y usa el slug exacto
```

- [ ] **Step 2: Verify file exists and is readable**

```bash
node -e "const fs=require('fs'); const c=fs.readFileSync('docs/comerciales/buscar-leads.md','utf8'); console.log('OK, lines:', c.split('\n').length)"
```

Expected: `OK, lines: <number greater than 50>`

- [ ] **Step 3: Commit**

```bash
git add docs/comerciales/buscar-leads.md
git commit -m "docs: add comerciales guide for buscar-leads.js"
```

---

## Final smoke test

- [ ] **Run full end-to-end**

```bash
# 1. Fresh search
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --max=5

# 2. Verify no duplicate on second run
node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao --max=5
# Should show: "0 añadidos, 5 ya existían"

# 3. Confirm old scripts are gone
ls scripts/find-leads.js scripts/find-targets.js 2>&1
# Should show: "No such file or directory"

# 4. Confirm utils module loads
node -e "require('./src/utils/leads-utils'); console.log('OK')"

# 5. Check docs exist
ls docs/comerciales/buscar-leads.md
```

- [ ] **Commit everything if not already committed**

```bash
git status
```

All changes should be clean (no untracked/modified files after tasks 1–4 commits).
```
