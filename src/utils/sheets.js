// ============================================
// NodeFlow — Google Sheets sync helper
// Usa Google Apps Script (sin service account)
// ============================================
// Setup (5 min, solo una vez):
//   1. Abre tu Google Sheet → Extensions → Apps Script
//   2. Pega el contenido de scripts/sheets-appscript.gs
//   3. Deploy → New deployment → Web App
//      · Execute as: Me
//      · Who has access: Anyone
//   4. Copia la URL del deployment
//   5. Añade al .env: GOOGLE_APPS_SCRIPT_URL=https://script.google.com/...
// ============================================

const https  = require('https');
const http   = require('http');
const { URL } = require('url');

/**
 * Appends leads to Google Sheets via Apps Script webhook.
 * Handles duplicates server-side (nombre+ciudad).
 * Returns { ok, added, skipped } or { ok: false, reason }
 */
async function appendLeadsToSheet(leads) {
  const webhookUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

  if (!webhookUrl) {
    return { ok: false, reason: 'GOOGLE_APPS_SCRIPT_URL not set' };
  }

  // Apps Script webhooks redirect to a follow-up URL — need to follow redirects
  return postWithRedirects(webhookUrl, { leads });
}

function postWithRedirects(urlStr, body, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed   = new URL(urlStr);
    const isHttps  = parsed.protocol === 'https:';
    const lib      = isHttps ? https : http;
    const bodyStr  = JSON.stringify(body);

    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = lib.request(opts, (res) => {
      // Follow redirects (Apps Script always redirects POST→GET, handle gracefully)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        // For 303, follow as GET
        if (res.statusCode === 303) {
          return getJson(res.headers.location).then(resolve).catch(reject);
        }
        return postWithRedirects(res.headers.location, body, redirectCount + 1)
          .then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ ok: true, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function getJson(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib    = parsed.protocol === 'https:' ? https : http;

    lib.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return getJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: true, raw: data }); }
      });
    }).on('error', reject);
  });
}

module.exports = { appendLeadsToSheet };
