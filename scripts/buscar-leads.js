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
//   GOOGLE_PLACES_API_KEY     → Google Cloud Console → Places API
//   GOOGLE_APPS_SCRIPT_URL    → Extensions → Apps Script → Deploy as Web App
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { dedup, buildWALink, writeCSV, pushToSheet } = require('../src/utils/leads-utils');

// ── Sector map: slug → Google query + Páginas Amarillas slug ─────────────────
const SECTOR_MAP = {
  dentistas:       { google: 'clínica dental',      pa: 'dentistas' },
  veterinarios:    { google: 'clínica veterinaria',  pa: 'veterinarios' },
  peluquerias:     { google: 'peluquería',           pa: 'peluquerias-y-salones-de-belleza' },
  estetica:        { google: 'centro de estética',   pa: 'centros-de-estetica' },
  gimnasios:       { google: 'gimnasio',             pa: 'gimnasios' },
  restaurantes:    { google: 'restaurante',          pa: 'restaurantes' },
  farmacias:       { google: 'farmacia',             pa: 'farmacias' },
  hoteles:         { google: 'hotel',                pa: 'hoteles' },
  academias:       { google: 'academia',             pa: 'academias' },
  asesoria:        { google: 'asesoría',             pa: 'gestores-asesores' },
  inmobiliarias:   { google: 'inmobiliaria',         pa: 'inmobiliarias' },
  talleres:        { google: 'taller mecánico',      pa: 'talleres-de-coches' },
  clinicas:        { google: 'clínica médica',       pa: 'clinicas' },
  fisioterapeutas: { google: 'fisioterapia',         pa: 'fisioterapeutas' },
};

// City coordinates for location-biased Google search
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
  burgos:      '42.3440,-3.6970',
  valladolid:  '41.6521,-4.7286',
  leon:        '42.6012,-5.5703',
  salamanca:   '40.9701,-5.6635',
  granada:     '37.1773,-3.5986',
};

// ── CLI argument parser ───────────────────────────────────────────────────────
function parseArgs() {
  const args = { max: 60, soloPa: false, noSheet: false };
  process.argv.slice(2).forEach(a => {
    if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    if (a === '--solo-pa')  { args.soloPa  = true; return; }
    if (a === '--no-sheet') { args.noSheet = true; return; }
    const eq = a.indexOf('=');
    if (eq === -1) return;
    const k = a.slice(2, eq);
    const v = a.slice(eq + 1);
    args[k] = isNaN(Number(v)) ? v : Number(v);
  });
  return args;
}

function printHelp() {
  console.log(`
NodeFlow — Buscador de Leads
─────────────────────────────────────────────────────────
Uso: node scripts/buscar-leads.js --sector=<sector> --ciudad=<ciudad> [opciones]

Opciones:
  --sector=<slug>    Sector a buscar (ver lista abajo)  [requerido]
  --ciudad=<nombre>  Ciudad objetivo                    [requerido]
  --max=<n>          Máximo de leads a buscar (default: 60)
  --solo-pa          Usar solo Páginas Amarillas (gratis, sin coste Google)
  --no-sheet         Solo guardar CSV local, no subir al Sheet
  --help             Mostrar esta ayuda

Sectores disponibles:
  dentistas | veterinarios | peluquerias | estetica | gimnasios
  restaurantes | farmacias | hoteles | academias | asesoria
  inmobiliarias | talleres | clinicas | fisioterapeutas

Ejemplos:
  node scripts/buscar-leads.js --sector=dentistas --ciudad=bilbao
  node scripts/buscar-leads.js --sector=restaurantes --ciudad=madrid --max=100
  node scripts/buscar-leads.js --sector=peluquerias --ciudad=donostia --solo-pa
`);
}

// ── HTTP JSON GET ─────────────────────────────────────────────────────────────
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

// ── Google Places search + details ───────────────────────────────────────────
async function googleSearch(googleQuery, ciudad, apiKey, maxResults) {
  const leads = [];
  let pageToken = null;
  let page = 0;
  let quotaExhausted = false;

  const cityKey = ciudad.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
  const coords = CITY_COORDS[cityKey];

  while (leads.length < maxResults) {
    page++;
    let url;
    if (pageToken) {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${apiKey}`;
    } else {
      const q = encodeURIComponent(`${googleQuery} en ${ciudad}`);
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&language=es&region=es&key=${apiKey}`;
      if (coords) url += `&location=${coords}&radius=10000`;
    }

    process.stdout.write(`   [Google] Página ${page}… `);
    const res = await get(url);

    if (res.status === 'OVER_QUERY_LIMIT') {
      console.log('⚠️  Cuota agotada — cambiando a Páginas Amarillas');
      quotaExhausted = true;
      break;
    }
    if (res.status === 'REQUEST_DENIED') {
      throw new Error('Google Places rechazó la API key: ' + (res.error_message || 'activa Places API en Google Cloud Console'));
    }
    if (res.status === 'ZERO_RESULTS' || !res.results?.length) {
      console.log('0 resultados');
      break;
    }

    const places = res.results || [];
    console.log(`${places.length} negocios encontrados`);

    for (const p of places) {
      if (leads.length >= maxResults) break;
      process.stdout.write(`      → ${(p.name || '').substring(0, 36).padEnd(36)} `);

      // Fetch phone, website, etc. from Place Details
      const fields = 'name,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,formatted_address';
      const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=${fields}&language=es&key=${apiKey}`;
      const det = await get(detUrl);
      await sleep(150); // respect rate limit

      const d = det.result || {};
      const telefono = (d.formatted_phone_number || d.international_phone_number || '').replace(/\s/g, '');
      console.log(telefono || '(sin tel)');

      leads.push({
        nombre:   d.name || p.name || '',
        sector:   googleQuery,
        ciudad,
        telefono,
        address:  d.formatted_address || p.formatted_address || '',
        rating:   String(d.rating   || p.rating   || ''),
        reviews:  String(d.user_ratings_total || p.user_ratings_total || ''),
        website:  d.website || '',
        maps_url: d.url || `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
        estado: '', notas: '', fecha_contacto: '',
      });
    }

    pageToken = res.next_page_token;
    if (!pageToken) break;
    await sleep(2000); // Google requires 2s between pagination requests
  }

  return { leads, quotaExhausted };
}

// ── Páginas Amarillas via scrape-leads.js ─────────────────────────────────────
function paSearch(paSector, ciudad, maxResults) {
  return new Promise(resolve => {
    const scriptPath = path.join(__dirname, 'scrape-leads.js');
    if (!fs.existsSync(scriptPath)) {
      console.log('   ⚠️  scrape-leads.js no encontrado — saltando PA');
      return resolve([]);
    }

    const args = [
      scriptPath,
      `--sector=${paSector}`,
      `--ciudad=${ciudad.toLowerCase()}`,
      '--paginas=5',
      '--delay=1500',
    ];

    process.stdout.write('   [PA] Buscando');
    const proc = execFile('node', args, { cwd: path.join(__dirname, '..') }, (err, stdout) => {
      console.log('');

      // scrape-leads.js writes CSV to project root — find and parse it
      const match = stdout.match(/CSV guardado: ([^\r\n]+\.csv)/);
      if (!match) {
        if (stdout.includes('captcha') || stdout.includes('Bloqueado')) {
          console.log('   ⚠️  PA bloqueó temporalmente — usa --delay=3000 o reintenta luego');
        }
        return resolve([]);
      }

      const csvPath = path.join(__dirname, '..', match[1].trim());
      if (!fs.existsSync(csvPath)) return resolve([]);

      try {
        const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1); // skip header
        const leads = lines
          .filter(l => l.trim())
          .slice(0, maxResults)
          .map(line => {
            // CSV: "Negocio","Teléfono","Dirección","Web"
            const cols = [];
            let cur = '', inQ = false;
            for (const ch of line) {
              if (ch === '"') { inQ = !inQ; }
              else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
              else { cur += ch; }
            }
            cols.push(cur);
            return {
              nombre:   cols[0] || '',
              sector:   paSector,
              ciudad,
              telefono: (cols[1] || '').replace(/\s/g, ''),
              address:  cols[2] || '',
              rating: '', reviews: '', website: cols[3] || '', maps_url: '',
              estado: '', notas: '', fecha_contacto: '',
            };
          })
          .filter(l => l.nombre);

        // Remove the temp CSV generated by scrape-leads (we'll write our own)
        try { fs.unlinkSync(csvPath); } catch {}
        resolve(leads);
      } catch (e) {
        console.log('   ⚠️  Error parseando CSV de PA:', e.message);
        resolve([]);
      }
    });

    proc.stdout?.on('data', () => process.stdout.write('.'));
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const args   = parseArgs();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // Validate required args
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
    console.error('   Usa --solo-pa para buscar solo en Páginas Amarillas (gratis).\n');
    process.exit(1);
  }

  const ciudad     = args.ciudad;
  const maxResults = args.max;

  console.log(`\n🔍 NodeFlow — Buscador de Leads`);
  console.log(`   Sector:  ${sectorInfo.google}`);
  console.log(`   Ciudad:  ${ciudad}`);
  console.log(`   Máx:     ${maxResults} leads`);
  console.log(`   Fuente:  ${args.soloPa ? 'Páginas Amarillas (forzado)' : 'Google Places + PA fallback'}\n`);

  let leads    = [];
  let needsPA  = false;

  // ── Primary: Google Places ──────────────────────────────────────────────────
  if (!args.soloPa && apiKey) {
    console.log('📍 Buscando en Google Places…');
    try {
      const { leads: gLeads, quotaExhausted } = await googleSearch(
        sectorInfo.google, ciudad, apiKey, maxResults
      );
      leads = gLeads;
      const withPhone = leads.filter(l => l.telefono).length;
      console.log(`\n   → ${leads.length} leads encontrados en Google (${withPhone} con teléfono)\n`);

      // Trigger PA fallback if quota is exhausted or too few results with phone
      // Threshold: 15 or 50% of requested max (whichever is lower)
      const paThreshold = Math.min(15, Math.floor(maxResults * 0.5));
      needsPA = quotaExhausted || withPhone < paThreshold;
      if (needsPA && !quotaExhausted) {
        console.log(`   Solo ${withPhone} leads con teléfono — complementando con Páginas Amarillas…\n`);
      }
    } catch (e) {
      console.error('   ❌ Error Google Places:', e.message);
      needsPA = true;
    }
  }

  // ── Fallback / complement: Páginas Amarillas ────────────────────────────────
  if (args.soloPa || needsPA) {
    console.log('📰 Buscando en Páginas Amarillas…');
    const paLeads = await paSearch(sectorInfo.pa, ciudad, maxResults);
    console.log(`   → ${paLeads.length} leads desde PA\n`);
    leads = dedup([...leads, ...paLeads]);
  }

  if (leads.length === 0) {
    console.log('⚠️  Sin resultados.');
    console.log('   Prueba con otro sector o ciudad, o verifica la API key.');
    process.exit(0);
  }

  // ── Enrich with WA links ────────────────────────────────────────────────────
  leads = leads.map(l => {
    const { wa_link, wa_mensaje } = buildWALink({ ...l, sector: sectorInfo.google });
    return { ...l, wa_link, wa_mensaje };
  });

  // ── Final dedup (Google + PA may overlap) ───────────────────────────────────
  leads = dedup(leads);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const withPhone = leads.filter(l => l.telefono).length;
  console.log(`📊 Resultados:`);
  console.log(`   Total encontrados: ${leads.length}`);
  console.log(`   Con teléfono:      ${withPhone} ← leads calientes`);
  console.log(`   Sin teléfono:      ${leads.length - withPhone}`);

  // ── Save CSV backup ─────────────────────────────────────────────────────────
  const date     = new Date().toISOString().split('T')[0];
  const citySlug = ciudad.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '-');
  const filename = `leads_${sectorSlug}_${citySlug}_${date}.csv`;
  const csvPath  = path.join(__dirname, '..', filename);
  writeCSV(leads, csvPath);
  console.log(`\n✅ CSV guardado: ${filename}`);

  // ── Push to Google Sheet ────────────────────────────────────────────────────
  if (!args.noSheet) {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('\n⚠️  GOOGLE_APPS_SCRIPT_URL no configurada — solo CSV guardado.');
      console.log('   Añade la URL al .env para sincronizar automáticamente con Google Sheets.');
    } else {
      process.stdout.write('\n📊 Subiendo al Sheet… ');
      const result = await pushToSheet(leads);
      if (result.ok) {
        console.log(`✅ ${result.added} añadidos, ${result.skipped} ya existían.`);
      } else {
        console.log(`⚠️  No se pudo subir al Sheet: ${result.reason || result.error}`);
        console.log(`   El CSV se ha guardado igualmente: ${filename}`);
      }
    }
  }

  // ── Preview top leads ───────────────────────────────────────────────────────
  const preview = leads.filter(l => l.telefono).slice(0, 5);
  if (preview.length) {
    console.log('\n📋 Primeros leads con teléfono:');
    preview.forEach((l, i) => {
      console.log(`   ${i+1}. ${l.nombre}`);
      console.log(`      📞 ${l.telefono}  ⭐ ${l.rating || '—'}  🌐 ${l.website || '—'}`);
      console.log(`      📍 ${l.address}`);
    });
  }
  console.log('');
}

main().catch(e => {
  console.error('\n❌ Error inesperado:', e.message);
  process.exit(1);
});
