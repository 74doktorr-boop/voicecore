#!/usr/bin/env node
// ============================================
// NodeFlow — Buscador de negocios target
// Usa Google Places API para encontrar 50+
// negocios reales y exporta CSV para outreach
//
// Uso:
//   node scripts/find-targets.js
//   node scripts/find-targets.js --city=Bilbao
//   node scripts/find-targets.js --sector=restaurante
//   node scripts/find-targets.js --max=100
//
// Requiere: GOOGLE_PLACES_API_KEY en .env
// ============================================

require('dotenv').config();
const https              = require('https');
const fs                 = require('fs');
const path               = require('path');
const { appendLeadsToSheet } = require('../src/utils/sheets');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const ARG_CITY  = args.find(a => a.startsWith('--city='))?.split('=')[1];
const ARG_SECT  = args.find(a => a.startsWith('--sector='))?.split('=')[1];
const ARG_MAX   = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '80');

// ─── Config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('❌  GOOGLE_PLACES_API_KEY no configurada en .env');
  process.exit(1);
}

const CITIES = ARG_CITY
  ? [ARG_CITY]
  : [
    // País Vasco
    'Bilbao', 'Donostia-San Sebastián', 'Vitoria-Gasteiz', 'Barakaldo', 'Getxo',
    // Navarra + La Rioja + Cantabria
    'Pamplona', 'Logroño', 'Santander',
    // Asturias
    'Oviedo', 'Gijón',
    // Galicia
    'A Coruña', 'Vigo', 'Santiago de Compostela', 'Pontevedra',
    // Aragón + Castilla y León
    'Zaragoza', 'Burgos', 'Valladolid', 'León', 'Salamanca',
    // Levante + Andalucía
    'Valencia', 'Alicante', 'Murcia', 'Sevilla', 'Málaga', 'Granada',
  ];

const SECTORS = ARG_SECT
  ? [ARG_SECT]
  : ['peluquería', 'clínica dental', 'restaurante', 'taller mecánico', 'estética', 'gimnasio', 'academia'];

// ─── Templates de mensaje WhatsApp por sector ─────────────────────────────────
const WA_TEMPLATES = {
  'peluquería': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Vi vuestra peluquería en ${ciudad}. Tengo una solución de IA que atiende reservas telefónicas 24h sin que tengas que coger el teléfono tú (o tu equipo). ¿Te cuento en 5 minutos cómo funciona?`,

  'clínica dental': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Trabajo con clínicas dentales en ${ciudad} para automatizar la recepción telefónica con IA. Citas, confirmaciones y cancelaciones sin coste de personal extra. ¿Tienes 5 minutos para verlo?`,

  'restaurante': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Os vi en ${ciudad} y me surgió una idea: ¿y si vuestra IA atendiera las reservas telefónicas de noche/fin de semana sin perder ninguna llamada? Sin apps, sin cambios. ¿Hablamos?`,

  'taller mecánico': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Ofrezco a talleres en ${ciudad} una IA que atiende llamadas de clientes 24h: citas, presupuestos, consultas. Tú solo ves lo que entra. ¿Te interesa probarlo gratis 7 días?`,

  'estética': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Vi vuestro centro en ${ciudad}. Trabajo con centros de estética para automatizar las reservas telefónicas con IA — sin perder una llamada aunque estéis atendiendo. ¿Te cuento?`,

  'gimnasio': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Vi vuestro gimnasio en ${ciudad}. Ofrezco una IA que atiende llamadas 24h: altas, horarios, clases. Los clientes llaman cuando quieren, vosotros no perdéis ninguna alta. ¿Te cuento en 5 min?`,

  'academia': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Vi vuestra academia en ${ciudad}. Tengo una IA que atiende consultas telefónicas y matriculaciones 24h sin que tengáis que coger el teléfono. ¿Te interesa verlo?`,

  'default': (nombre, ciudad) =>
    `Hola ${nombre} 👋 Os vi en ${ciudad}. Tengo una IA que atiende vuestras llamadas 24h — reservas, consultas, citas — sin perderse nada. ¿5 minutos para verlo?`,
};

function getTemplate(sector, nombre, ciudad) {
  const key = Object.keys(WA_TEMPLATES).find(k => sector.toLowerCase().includes(k)) || 'default';
  return WA_TEMPLATES[key](nombre, ciudad);
}

// ─── Google Places Text Search ─────────────────────────────────────────────────
function placesSearch(query, pageToken = null) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      query,
      key:      API_KEY,
      language: 'es',
      region:   'es',
    });
    if (pageToken) params.set('pagetoken', pageToken);

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;

    https.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function placesDetails(placeId) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      place_id: placeId,
      fields:   'name,formatted_phone_number,website,url,rating,user_ratings_total,formatted_address',
      key:      API_KEY,
      language: 'es',
    });

    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;

    https.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).result || {});
        } catch (e) {
          resolve({});
        }
      });
    }).on('error', () => resolve({}));
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── CSV ───────────────────────────────────────────────────────────────────────
function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

function toCsvRow(obj) {
  return Object.values(obj).map(escapeCsv).join(',');
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍  NodeFlow — Buscador de targets para outreach\n');
  console.log(`📍  Ciudades : ${CITIES.join(', ')}`);
  console.log(`🏢  Sectores : ${SECTORS.join(', ')}`);
  console.log(`📊  Máximo   : ${ARG_MAX} registros\n`);

  const results = [];
  const seen    = new Set(); // evitar duplicados por placeId

  const searches = [];
  for (const city of CITIES) {
    for (const sector of SECTORS) {
      searches.push({ city, sector, query: `${sector} en ${city}` });
    }
  }

  let done = 0;
  for (const { city, sector, query } of searches) {
    if (results.length >= ARG_MAX) break;

    process.stdout.write(`  🔎 "${query}" … `);

    try {
      const data = await placesSearch(query);

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.log(`⚠️  ${data.status} — ${data.error_message || ''}`);
        continue;
      }

      const places = (data.results || []).slice(0, 5); // max 5 por búsqueda para no exceder quota
      console.log(`${places.length} resultados`);

      for (const place of places) {
        if (results.length >= ARG_MAX) break;
        if (seen.has(place.place_id)) continue;
        seen.add(place.place_id);

        // Pedir detalles (teléfono, website)
        await sleep(200); // respetar rate limit
        const det = await placesDetails(place.place_id);

        const nombre   = det.name || place.name || '';
        const telefono = det.formatted_phone_number || '';
        const website  = det.website || '';
        const maps_url = det.url || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`;
        const rating   = det.rating || place.rating || '';
        const reviews  = det.user_ratings_total || place.user_ratings_total || '';
        const address  = det.formatted_address || place.formatted_address || '';

        const waMsg = telefono
          ? getTemplate(sector, nombre, city)
          : '(sin teléfono — buscar manualmente)';

        const waLink = telefono
          ? `https://wa.me/34${telefono.replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}`
          : '';

        results.push({
          nombre,
          sector,
          ciudad:      city,
          telefono,
          address,
          rating,
          reviews,
          website,
          maps_url,
          wa_link:     waLink,
          wa_mensaje:  waMsg,
          estado:      '',  // para rellenar: 'contactado', 'interesado', 'demo', 'cliente', 'no interesa'
          notas:       '',
          fecha_contacto: '',
        });

        done++;
        process.stdout.write(`    ✅ ${nombre} — ${telefono || 'sin tel'}\n`);
      }

    } catch (e) {
      console.log(`❌  Error: ${e.message}`);
    }

    await sleep(500); // pausa entre búsquedas
  }

  if (results.length === 0) {
    console.log('\n⚠️  Sin resultados. Comprueba que GOOGLE_PLACES_API_KEY es válida.');
    return;
  }

  // ─── Escribir CSV ────────────────────────────────────────────────────────────
  const headers = [
    'nombre', 'sector', 'ciudad', 'telefono', 'address', 'rating', 'reviews',
    'website', 'maps_url', 'wa_link', 'wa_mensaje', 'estado', 'notas', 'fecha_contacto',
  ];

  const lines = [
    headers.join(','),
    ...results.map(toCsvRow),
  ];

  const outPath = path.join(process.cwd(), 'outreach-targets.csv');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');

  console.log(`\n✅  ${results.length} negocios guardados en: outreach-targets.csv`);
  console.log('\n📋  Resumen por ciudad:');
  for (const city of CITIES) {
    const n = results.filter(r => r.ciudad === city).length;
    if (n > 0) console.log(`    ${city}: ${n}`);
  }
  console.log('\n📋  Resumen por sector:');
  for (const sector of SECTORS) {
    const n = results.filter(r => r.sector === sector).length;
    if (n > 0) console.log(`    ${sector}: ${n}`);
  }

  // ─── Sync a Google Sheets (si está configurado) ───────────────────────────
  if (process.env.GOOGLE_SHEET_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON)) {
    console.log('\n📊  Sincronizando con Google Sheets…');
    try {
      const sync = await appendLeadsToSheet(results);
      if (sync.ok) {
        console.log(`    ✅ ${sync.added} leads nuevos añadidos (${sync.skipped} ya existían)`);
        console.log(`    👉 https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`);
      } else {
        console.log(`    ⚠️  Sheets no configurado (${sync.reason}) — solo CSV generado`);
      }
    } catch (e) {
      console.log(`    ❌ Error Sheets: ${e.message}`);
    }
  } else {
    console.log('\n💡  Para sync automático con Google Sheets:');
    console.log('    Añade GOOGLE_SHEET_ID + GOOGLE_SERVICE_ACCOUNT_KEY al .env');
  }
}

main().catch(e => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});
