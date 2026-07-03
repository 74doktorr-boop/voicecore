// ============================================================
// NodeFlow — IndexNow (#6 SEO marca): notifica a Bing/Yandex las
// URLs del sitemap para indexación inmediata (Google no usa
// IndexNow; GSC ya está verificado aparte).
//
// Uso:  node scripts/indexnow-submit.js            → envía TODO el sitemap
//       node scripts/indexnow-submit.js /demo /precios → solo esas rutas
//
// La key vive en public/<KEY>.txt (requisito del protocolo: el
// buscador la verifica en https://nodeflow.es/<KEY>.txt).
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const HOST = 'nodeflow.es';
const KEY = '8c76c906661a880fc4fcbaa80d2c25fe';
const SITEMAP = path.join(__dirname, '..', 'public', 'sitemap.xml');

/** Extrae las URLs <loc> de un sitemap XML. Exportada para test. */
function extractLocs(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) out.push(m[1]);
  return out;
}

function submit(urlList) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.indexnow.org', path: '/indexnow', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  const args = process.argv.slice(2);
  let urls;
  if (args.length) {
    urls = args.map(a => (a.startsWith('http') ? a : `https://${HOST}${a.startsWith('/') ? a : '/' + a}`));
  } else {
    urls = extractLocs(fs.readFileSync(SITEMAP, 'utf8'));
  }
  if (!urls.length) { console.error('Sin URLs que enviar'); process.exit(1); }
  console.log(`IndexNow: enviando ${urls.length} URLs de ${HOST}…`);
  const res = await submit(urls.slice(0, 10000)); // límite del protocolo
  // 200 = OK, 202 = aceptado (key pendiente de verificar) — ambos son éxito
  console.log(`IndexNow: HTTP ${res.status} ${res.body || ''}`.trim());
  if (res.status !== 200 && res.status !== 202) process.exit(1);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { extractLocs };
