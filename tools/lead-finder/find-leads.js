#!/usr/bin/env node
// ============================================================
// NodeFlow — Lead Finder (captación de clientes para vender)
// Encuentra negocios locales con la API oficial de Google Places
// y filtra los que MÁS encajan con NodeFlow: tienen teléfono pero
// no tienen web (los que más llamadas pierden).
//
// Uso:
//   GOOGLE_PLACES_API_KEY=xxx node find-leads.js
//   GOOGLE_PLACES_API_KEY=xxx node find-leads.js --config mi-config.json
//
// Salida: leads-YYYY-MM-DD.csv (ábrelo en Google Sheets / Airtable)
//
// Requiere Node 18+ (fetch nativo). Sin dependencias externas.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Campos que pedimos a Google (field mask — solo pagas por lo que pides)
const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

// ── Configuración por defecto (edítala o pásala con --config) ────────────────
const DEFAULT_CONFIG = {
  // Sectores que te interesan (los que reciben muchas llamadas/citas)
  sectors: [
    'clínica dental', 'peluquería', 'fisioterapia', 'centro de estética',
    'veterinaria', 'taller mecánico', 'gimnasio', 'clínica de podología',
  ],
  // Ciudades / zonas donde vendes
  cities: ['Bilbao', 'Donostia', 'Vitoria-Gasteiz', 'Pamplona'],
  // Filtros del lead ideal para NodeFlow
  filters: {
    onlyWithoutWebsite: true,   // ⭐ el filtro clave: negocios sin web (pierden llamadas)
    requirePhone:       true,   // necesitamos teléfono para contactar
    minRatingCount:     5,      // negocios establecidos (con reseñas)
    onlyOperational:    true,   // descartar cerrados definitivamente
  },
  maxPagesPerQuery: 3,          // 3 páginas ≈ 60 resultados por búsqueda (máx Google)
  regionCode: 'ES',
  languageCode: 'es',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function searchTextPage(query, pageToken) {
  const body = {
    textQuery: query,
    languageCode: CONFIG.languageCode,
    regionCode: CONFIG.regionCode,
  };
  if (pageToken) body.pageToken = pageToken;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Recorre todas las páginas de una búsqueda y devuelve los lugares. */
async function searchAll(query) {
  const places = [];
  let pageToken = null;
  for (let page = 0; page < CONFIG.maxPagesPerQuery; page++) {
    const data = await searchTextPage(query, pageToken);
    (data.places || []).forEach(p => places.push(p));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await sleep(2000); // el nextPageToken tarda un poco en activarse
  }
  return places;
}

/** ¿El lugar pasa los filtros del lead ideal? */
function passesFilters(p, f) {
  if (f.onlyOperational && p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
  if (f.requirePhone && !p.nationalPhoneNumber && !p.internationalPhoneNumber) return false;
  if (f.onlyWithoutWebsite && p.websiteUri) return false;
  if (f.minRatingCount && (p.userRatingCount || 0) < f.minRatingCount) return false;
  return true;
}

function placeToRow(p, sector, city) {
  return {
    nombre:    p.displayName?.text || '',
    sector,
    ciudad:    city,
    telefono:  p.nationalPhoneNumber || p.internationalPhoneNumber || '',
    web:       p.websiteUri || '',
    direccion: p.formattedAddress || '',
    valoracion: p.rating || '',
    num_resenas: p.userRatingCount || 0,
    tipo:      p.primaryTypeDisplayName?.text || '',
    google_maps: p.googleMapsUri || '',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
let CONFIG = DEFAULT_CONFIG;

async function main() {
  if (!API_KEY) {
    console.error('\n❌ Falta GOOGLE_PLACES_API_KEY.\n   Crea la clave (ver README.md) y ejecútalo así:\n   GOOGLE_PLACES_API_KEY=tu_clave node find-leads.js\n');
    process.exit(1);
  }

  // Cargar config personalizada si se pasa --config
  const cfgIdx = process.argv.indexOf('--config');
  if (cfgIdx !== -1 && process.argv[cfgIdx + 1]) {
    const custom = JSON.parse(fs.readFileSync(process.argv[cfgIdx + 1], 'utf8'));
    CONFIG = { ...DEFAULT_CONFIG, ...custom, filters: { ...DEFAULT_CONFIG.filters, ...(custom.filters || {}) } };
  }

  const f = CONFIG.filters;
  console.log(`\n🔎 Buscando leads en ${CONFIG.cities.length} ciudades × ${CONFIG.sectors.length} sectores…`);
  console.log(`   Filtro: ${f.onlyWithoutWebsite ? 'SIN web · ' : ''}${f.requirePhone ? 'con teléfono · ' : ''}mín ${f.minRatingCount} reseñas\n`);

  const seen = new Set(); // dedupe por teléfono o nombre+dirección
  const leads = [];
  let totalFound = 0, apiCalls = 0;

  for (const city of CONFIG.cities) {
    for (const sector of CONFIG.sectors) {
      const query = `${sector} en ${city}`;
      process.stdout.write(`   • ${query}… `);
      try {
        const places = await searchAll(query);
        apiCalls++;
        let kept = 0;
        for (const p of places) {
          totalFound++;
          if (!passesFilters(p, f)) continue;
          const key = (p.nationalPhoneNumber || '') + '|' + (p.displayName?.text || '') + (p.formattedAddress || '');
          if (seen.has(key)) continue;
          seen.add(key);
          leads.push(placeToRow(p, sector, city));
          kept++;
        }
        console.log(`${places.length} negocios, ${kept} leads`);
        await sleep(500); // ser amable con la API
      } catch (e) {
        console.log(`error: ${e.message}`);
        if (e.message.includes('403') || e.message.includes('API_KEY')) {
          console.error('\n⚠️  Error de clave/permisos. Revisa que la Places API (New) esté habilitada en tu proyecto de Google Cloud.\n');
          break;
        }
      }
    }
  }

  // Escribir CSV
  if (leads.length === 0) {
    console.log('\n⚠️  No se encontraron leads con esos filtros. Prueba a bajar minRatingCount o quitar onlyWithoutWebsite.\n');
    return;
  }

  const headers = ['nombre', 'sector', 'ciudad', 'telefono', 'web', 'direccion', 'valoracion', 'num_resenas', 'tipo', 'google_maps'];
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(__dirname, `leads-${stamp}.csv`);
  const csv = '﻿' + // BOM para que Excel/Sheets lean bien los acentos
    headers.join(',') + '\n' +
    leads.map(l => headers.map(h => csvEscape(l[h])).join(',')).join('\n');
  fs.writeFileSync(file, csv, 'utf8');

  console.log(`\n✅ ${leads.length} leads guardados en:\n   ${file}`);
  console.log(`   (${totalFound} negocios revisados en ${apiCalls} búsquedas)`);
  console.log(`\n💡 Ábrelo en Google Sheets (Archivo → Importar) o Airtable y empieza a contactar.\n`);
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
