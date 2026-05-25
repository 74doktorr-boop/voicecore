#!/usr/bin/env node
// ============================================
// NodeFlow — Lead Finder
// Busca negocios por sector + ciudad usando
// Google Places API (Text Search)
//
// Uso:
//   node scripts/find-leads.js \
//     --sector="clinica dental" \
//     --city="Bilbao" \
//     --radius=5000 \
//     --max=60
//
// Necesitas: GOOGLE_PLACES_API_KEY en .env
// (Google Cloud Console → Places API → gratis hasta $200/mes)
//
// Salida: leads_[sector]_[city]_[fecha].csv
// ============================================

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const SECTORES = {
  clinica_dental:  'clínica dental',
  veterinaria:     'clínica veterinaria',
  peluqueria:      'peluquería',
  estetica:        'centro de estética',
  gimnasio:        'gimnasio',
  restaurante:     'restaurante',
  farmacia:        'farmacia',
  hotel:           'hotel',
  academia:        'academia',
  asesoria:        'asesoría',
  inmobiliaria:    'inmobiliaria',
  taller:          'taller mecánico',
};

// Ciudades con coordenadas (para Nearby Search)
const CIUDADES = {
  bilbao:        { lat: 43.2627,  lng: -2.9253 },
  donostia:      { lat: 43.3183,  lng: -1.9812 },
  vitoria:       { lat: 42.8467,  lng: -2.6728 },
  pamplona:      { lat: 42.8125,  lng: -1.6458 },
  madrid:        { lat: 40.4168,  lng: -3.7038 },
  barcelona:     { lat: 41.3851,  lng:  2.1734 },
  valencia:      { lat: 39.4699,  lng: -0.3763 },
  sevilla:       { lat: 37.3891,  lng: -5.9845 },
  zaragoza:      { lat: 41.6488,  lng: -0.8891 },
};

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(a => {
    const [k, v] = a.replace('--', '').split('=');
    args[k] = v;
  });
  return args;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.substring(0,200))); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Place Details ─────────────────────────────────────────────────────────────
async function getDetails(placeId) {
  const fields = 'name,formatted_address,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,opening_hours,business_status';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=es&key=${API_KEY}`;
  try {
    const res = await get(url);
    return res.result || {};
  } catch(e) {
    return {};
  }
}

// ── Text Search ───────────────────────────────────────────────────────────────
async function searchPlaces(query, city, radius = 5000, pageToken = null) {
  const ciudadCoords = CIUDADES[city.toLowerCase()];
  let url;

  if (ciudadCoords && !pageToken) {
    // Nearby Search (más preciso por radio)
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + city)}&location=${ciudadCoords.lat},${ciudadCoords.lng}&radius=${radius}&language=es&key=${API_KEY}`;
  } else if (pageToken) {
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${API_KEY}`;
  } else {
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + city)}&language=es&key=${API_KEY}`;
  }

  return get(url);
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function toCSV(leads) {
  const headers = ['Negocio','Teléfono','Teléfono Internacional','Dirección','Web','Rating','Reseñas','Estado','place_id'];
  const rows = leads.map(l => [
    `"${(l.name||'').replace(/"/g,'')}"`,
    `"${l.phone||''}"`,
    `"${l.phoneInt||''}"`,
    `"${(l.address||'').replace(/"/g,'')}"`,
    `"${l.website||''}"`,
    l.rating || '',
    l.reviews || '',
    l.status || '',
    l.placeId || '',
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (!API_KEY) {
    console.error('\n❌ GOOGLE_PLACES_API_KEY no está configurada en .env');
    console.error('   1. Ve a https://console.cloud.google.com');
    console.error('   2. Activa "Places API"');
    console.error('   3. Crea una API key y añádela al .env\n');
    process.exit(1);
  }

  const sectorKey  = args.sector?.replace(/ /g,'_').toLowerCase() || 'clinica_dental';
  const sectorName = SECTORES[sectorKey] || args.sector || 'clínica dental';
  const city       = args.city || 'Bilbao';
  const radius     = parseInt(args.radius) || 5000;
  const maxResults = parseInt(args.max) || 60;

  console.log(`\n🔍 NodeFlow Lead Finder`);
  console.log(`   Sector:   ${sectorName}`);
  console.log(`   Ciudad:   ${city}`);
  console.log(`   Radio:    ${radius}m`);
  console.log(`   Máx:      ${maxResults} resultados\n`);

  const leads = [];
  let pageToken = null;
  let page = 0;

  while (leads.length < maxResults) {
    page++;
    process.stdout.write(`   Página ${page}… `);

    const res = await searchPlaces(sectorName, city, radius, pageToken);

    if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS') {
      console.error(`\n❌ API error: ${res.status} — ${res.error_message || ''}`);
      if (res.status === 'REQUEST_DENIED') {
        console.error('   Verifica que la API key tiene Places API activada.');
      }
      break;
    }

    const places = res.results || [];
    console.log(`${places.length} negocios encontrados`);

    for (const p of places) {
      if (leads.length >= maxResults) break;
      process.stdout.write(`   → ${p.name.substring(0,40).padEnd(40)} `);

      // Get details (phone, website)
      const details = await getDetails(p.place_id);
      await sleep(100); // respect rate limits

      const lead = {
        name:     details.name     || p.name,
        phone:    details.formatted_phone_number || '',
        phoneInt: details.international_phone_number || '',
        address:  details.formatted_address || p.formatted_address || '',
        website:  details.website  || '',
        rating:   details.rating   || p.rating || '',
        reviews:  details.user_ratings_total || p.user_ratings_total || 0,
        status:   details.business_status || p.business_status || 'OPERATIONAL',
        placeId:  p.place_id,
      };

      leads.push(lead);
      const phone = lead.phone || lead.phoneInt || '(sin teléfono)';
      console.log(`✓ ${phone}`);
    }

    pageToken = res.next_page_token;
    if (!pageToken) break;

    // Google requires 2s delay between pagination requests
    await sleep(2000);
  }

  // Filter: only operational, with phone
  const withPhone = leads.filter(l => l.phone || l.phoneInt);
  const noPhone   = leads.filter(l => !l.phone && !l.phoneInt);

  console.log(`\n📊 Resultados:`);
  console.log(`   Total encontrados:   ${leads.length}`);
  console.log(`   Con teléfono:        ${withPhone.length}`);
  console.log(`   Sin teléfono:        ${noPhone.length}`);

  // Save CSV
  const date     = new Date().toISOString().split('T')[0];
  const filename = `leads_${sectorKey}_${city.toLowerCase()}_${date}.csv`;
  const filepath = path.join(__dirname, '..', filename);

  fs.writeFileSync(filepath, toCSV(leads), 'utf8');
  console.log(`\n✅ CSV guardado: ${filename}`);
  console.log(`   ${leads.length} negocios · ${withPhone.length} con teléfono directo\n`);

  // Preview top 5
  if (leads.length > 0) {
    console.log('📋 Primeros resultados:');
    leads.slice(0, 5).forEach((l, i) => {
      console.log(`   ${i+1}. ${l.name}`);
      console.log(`      📞 ${l.phone || l.phoneInt || '—'}  🌐 ${l.website || '—'}`);
      console.log(`      📍 ${l.address}`);
    });
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
