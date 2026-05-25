#!/usr/bin/env node
// ============================================
// NodeFlow — Lead Scraper ilimitado
// Fuente: Páginas Amarillas España (paginasamarillas.es)
// 100% gratuito, sin límites de API, sin API key
//
// Uso:
//   node scripts/scrape-leads.js --sector=dentistas --ciudad=bilbao
//   node scripts/scrape-leads.js --sector=veterinarios --ciudad=donostia --paginas=5
//   node scripts/scrape-leads.js --sector=peluquerias-y-salones-de-belleza --provincia=vizcaya
//
// Salida: leads_[sector]_[ciudad]_[fecha].csv
//
// Sectores disponibles:
//   dentistas | veterinarios | peluquerias-y-salones-de-belleza
//   centros-de-estetica | gimnasios | restaurantes | farmacias
//   hoteles | academias | gestores-asesores | inmobiliarias
//   talleres-de-coches | clinicas | fisioterapeutas
// ============================================

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = { paginas: 10, delay: 1500 };
  process.argv.slice(2).forEach(a => {
    const [k, v] = a.replace('--', '').split('=');
    args[k] = isNaN(Number(v)) ? v : Number(v);
  });
  return args;
}

// ── Slug helpers ──────────────────────────────────────────────────────────────
const CITY_SLUGS = {
  bilbao:     'vizcaya/bilbao',
  donostia:   'guipuzcoa/san-sebastian',
  'san-sebastian': 'guipuzcoa/san-sebastian',
  vitoria:    'alava/vitoria-gasteiz',
  pamplona:   'navarra/pamplona',
  madrid:     'madrid/madrid',
  barcelona:  'barcelona/barcelona',
  valencia:   'valencia/valencia',
  sevilla:    'sevilla/sevilla',
  zaragoza:   'zaragoza/zaragoza',
  malaga:     'malaga/malaga',
  murcia:     'murcia/murcia',
};

function cityPath(ciudad, provincia) {
  if (ciudad && CITY_SLUGS[ciudad.toLowerCase()]) return CITY_SLUGS[ciudad.toLowerCase()];
  if (ciudad && provincia) return `${provincia.toLowerCase()}/${ciudad.toLowerCase().replace(/ /g, '-')}`;
  if (provincia) return provincia.toLowerCase();
  return 'all';
}

// ── HTTP fetch with retry ─────────────────────────────────────────────────────
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Accept-Encoding': 'identity',
      }
    };

    const req = https.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return resolve(''); // empty = no results
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    });

    req.on('error', e => resolve('')); // graceful
    req.setTimeout(12000, () => { req.destroy(); resolve(''); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Extract listings from HTML ────────────────────────────────────────────────
// Páginas Amarillas structure (may change, but has been stable for years):
// Each listing is inside <article class="res ...">
// Name: <h3 class="title-link ...">  or  <span class="nombre">
// Phone: data-phone or <span class="phone"> or <a href="tel:...">
// Address: <span class="address"> or <address>
// Web: <a href="...">www</a> with class "web-site" or href starting with http outside the domain

function extractListings(html) {
  const leads = [];

  // Split by article/listing boundaries — PA uses article elements for each result
  const articlePattern = /<article[^>]*class="[^"]*\bres\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let artMatch;

  while ((artMatch = articlePattern.exec(html)) !== null) {
    const block = artMatch[1];

    // Name: varios patrones
    const namePatterns = [
      /<h3[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      /<span[^>]*class="[^"]*nombre[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<h3[^>]*>([\s\S]*?)<\/h3>/i,
    ];
    let name = '';
    for (const p of namePatterns) {
      const m = block.match(p);
      if (m) { name = stripTags(m[1]).trim(); break; }
    }
    if (!name) continue; // skip if no name

    // Phone: busca data-phone primero (el más fiable), luego tel: href
    let phone = '';
    const dataPhone = block.match(/data-phone="([^"]+)"/);
    const telHref   = block.match(/href="tel:([^"]+)"/);
    const spanPhone = block.match(/<[^>]*class="[^"]*phone[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    if (dataPhone)  phone = dataPhone[1].trim();
    else if (telHref) phone = telHref[1].trim();
    else if (spanPhone) phone = stripTags(spanPhone[1]).trim();

    // Address
    let address = '';
    const addrPatterns = [
      /<address[^>]*>([\s\S]*?)<\/address>/i,
      /<span[^>]*class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      /<span[^>]*class="[^"]*dir[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ];
    for (const p of addrPatterns) {
      const m = block.match(p);
      if (m) { address = stripTags(m[1]).replace(/\s+/g, ' ').trim(); break; }
    }

    // Website — busca href que empiece con http y no sea del propio PA
    let website = '';
    const wsPatterns = [
      /href="(https?:\/\/(?!(?:www\.)?paginasamarillas)[^"]+)"/i,
      /class="[^"]*web[^"]*"[^>]*href="([^"]+)"/i,
    ];
    for (const p of wsPatterns) {
      const m = block.match(p);
      if (m && !m[1].includes('paginasamarillas')) { website = m[1].trim(); break; }
    }

    leads.push({ name, phone, address, website });
  }

  // Fallback: if article pattern didn't match, try li.res pattern
  if (leads.length === 0) {
    const liPattern = /<li[^>]*class="[^"]*\bres\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liPattern.exec(html)) !== null) {
      const block = liMatch[1];
      const nameM   = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const phoneM  = block.match(/data-phone="([^"]+)"|href="tel:([^"]+)"/i);
      const addrM   = block.match(/<address[^>]*>([\s\S]*?)<\/address>/i);
      const webM    = block.match(/href="(https?:\/\/(?!(?:www\.)?paginasamarillas)[^"]+)"/i);

      if (!nameM) continue;
      leads.push({
        name:    stripTags(nameM[1]).trim(),
        phone:   phoneM ? (phoneM[1] || phoneM[2] || '').trim() : '',
        address: addrM  ? stripTags(addrM[1]).replace(/\s+/g, ' ').trim() : '',
        website: webM && !webM[1].includes('paginasamarillas') ? webM[1].trim() : '',
      });
    }
  }

  return leads;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&aacute;/g,'á').replace(/&eacute;/g,'é').replace(/&iacute;/g,'í').replace(/&oacute;/g,'ó').replace(/&uacute;/g,'ú').replace(/&ntilde;/g,'ñ').replace(/&Ntilde;/g,'Ñ').replace(/&uuml;/g,'ü').replace(/&#[0-9]+;/g,'').replace(/&[a-z]+;/g,'').replace(/\s+/g,' ').trim();
}

function hasNextPage(html) {
  return /<a[^>]*(?:class="[^"]*next[^"]*"|rel="next")[^>]*>/i.test(html) ||
         /página siguiente/i.test(html) ||
         /<li[^>]*class="[^"]*next[^"]*"[^>]*>/i.test(html);
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function toCSV(leads) {
  const header = ['Negocio', 'Teléfono', 'Dirección', 'Web'];
  const rows   = leads.map(l =>
    [
      `"${(l.name    || '').replace(/"/g, "'")}"`,
      `"${(l.phone   || '').replace(/"/g, "'")}"`,
      `"${(l.address || '').replace(/"/g, "'")}"`,
      `"${(l.website || '').replace(/"/g, "'")}"`,
    ].join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (!args.sector) {
    console.log('\n🔍 NodeFlow Lead Scraper — Páginas Amarillas (ilimitado, gratis)\n');
    console.log('Uso: node scripts/scrape-leads.js --sector=dentistas --ciudad=bilbao --paginas=5\n');
    console.log('Sectores más usados:');
    console.log('  dentistas | veterinarios | peluquerias-y-salones-de-belleza');
    console.log('  centros-de-estetica | gimnasios | restaurantes | farmacias');
    console.log('  hoteles | academias | gestores-asesores | inmobiliarias | clinicas\n');
    console.log('Ciudades: bilbao | donostia | vitoria | pamplona | madrid | barcelona | ...\n');
    process.exit(0);
  }

  const sector   = args.sector;
  const ciudad   = args.ciudad || args.city || null;
  const provincia = args.provincia || null;
  const maxPages = args.paginas || args.pages || 10;
  const delay    = args.delay   || 1500; // ms entre páginas (respeta el servidor)

  const geoPath  = cityPath(ciudad, provincia);

  console.log(`\n🔍 NodeFlow Lead Scraper`);
  console.log(`   Sector:  ${sector}`);
  console.log(`   Ciudad:  ${ciudad || provincia || 'toda España'}`);
  console.log(`   Páginas: hasta ${maxPages} (~${maxPages * 20} resultados)\n`);

  const allLeads = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1
      ? `https://www.paginasamarillas.es/a/${sector}/${geoPath}/`
      : `https://www.paginasamarillas.es/a/${sector}/${geoPath}/?p=${page}`;

    process.stdout.write(`   Página ${page}/${maxPages}: ${url}\n   `);
    const html = await fetchPage(url);

    if (!html) {
      console.log(`   ⚠️  Sin respuesta en página ${page}, parando.`);
      break;
    }

    if (html.includes('No hemos encontrado') || html.includes('no encontramos')) {
      console.log('   0 resultados. Revisa el sector o ciudad.');
      break;
    }

    const listings = extractListings(html);
    console.log(`   → ${listings.length} negocios`);

    if (listings.length === 0) {
      // Try to detect if there's a CAPTCHA or block
      if (html.includes('captcha') || html.includes('Access denied') || html.includes('403')) {
        console.log('   ⚠️  Bloqueado temporalmente. Espera 30 segundos y vuelve a intentar.');
        console.log('   💡 Tip: si se bloquea frecuentemente, aumenta --delay=3000');
        break;
      }
      if (!hasNextPage(html)) break; // última página real
    }

    allLeads.push(...listings);

    // Deduplicar por nombre+teléfono
    const seen = new Set();
    const unique = allLeads.filter(l => {
      const key = `${l.name}|${l.phone}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    allLeads.length = 0;
    allLeads.push(...unique);

    if (!hasNextPage(html)) {
      console.log(`\n   Última página alcanzada.`);
      break;
    }

    if (page < maxPages) await sleep(delay); // pausa entre páginas
  }

  // Filtrar por teléfono
  const conTel = allLeads.filter(l => l.phone);
  const sinTel = allLeads.filter(l => !l.phone);

  console.log(`\n📊 Resultados:`);
  console.log(`   Total:        ${allLeads.length}`);
  console.log(`   Con teléfono: ${conTel.length} ← estos son los leads`);
  console.log(`   Sin teléfono: ${sinTel.length}`);

  if (allLeads.length === 0) {
    console.log('\n⚠️  No se extrajeron resultados.');
    console.log('   Posibles causas:');
    console.log('   1. El sector no existe en PA (prueba con otro nombre)');
    console.log('   2. La ciudad no está en el slug map (prueba con --provincia=vizcaya)');
    console.log('   3. PA cambió su HTML — contacta para actualizar el parser');
    process.exit(1);
  }

  // Guardar CSV
  const date     = new Date().toISOString().split('T')[0];
  const geoSlug  = (ciudad || provincia || 'españa').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const filename = `leads_${sector}_${geoSlug}_${date}.csv`;
  const filepath = path.join(__dirname, '..', filename);
  fs.writeFileSync(filepath, toCSV(allLeads), 'utf8');

  console.log(`\n✅ CSV guardado: ${filename}`);
  console.log(`   ${allLeads.length} negocios totales · ${conTel.length} con teléfono directo\n`);

  // Preview
  console.log('📋 Primeros 5 leads:');
  allLeads.slice(0, 5).forEach((l, i) => {
    console.log(`   ${i+1}. ${l.name}`);
    console.log(`      📞 ${l.phone || '—'}  🌐 ${l.website || '—'}`);
    console.log(`      📍 ${l.address || '—'}`);
  });
  console.log('');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
