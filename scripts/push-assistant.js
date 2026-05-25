#!/usr/bin/env node
// ============================================
// NodeFlow — Push assistant + reload en caliente
// Sube un asistente al servidor de producción
// Y lo recarga sin necesidad de redeploy.
//
// Uso:
//   node scripts/push-assistant.js lumina-estetica
//   node scripts/push-assistant.js demo-clinic
//   node scripts/push-assistant.js all   ← sube todos
// ============================================

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const SERVER  = process.env.SERVER_URL || 'https://voicecore-voicecore-api.xmehd4.easypanel.host';
const API_KEY = process.env.API_KEY    || 'vc_nodeflow_prod_2026';
const target  = process.argv[2]        || 'lumina-estetica';

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function request(urlStr, method, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':   'application/json',
        'x-api-key':       API_KEY,
        ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
        ...extraHeaders,
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ─── Load assistant files ─────────────────────────────────────────────────────
function getAssistantFiles() {
  const dir = path.join(__dirname, '..', 'assistants');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      id:     path.basename(f, '.json'),
      path:   path.join(dir, f),
      config: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
    }));
}

// ─── Push one assistant ───────────────────────────────────────────────────────
async function pushAssistant(config) {
  console.log(`\n📤 Subiendo "${config.name || config.id}"...`);

  // Try PUT (update) first, then POST (create)
  let res = await request(`${SERVER}/api/assistants/${config.id}`, 'PUT', config);

  if (res.status === 404) {
    res = await request(`${SERVER}/api/assistants`, 'POST', config);
  }

  if (res.status === 200 || res.status === 201) {
    console.log(`   ✅ OK — ${config.name || config.id}`);
    return true;
  } else {
    console.error(`   ❌ Error ${res.status}:`, typeof res.body === 'object' ? res.body.error : res.body);
    return false;
  }
}

// ─── Reload en caliente ───────────────────────────────────────────────────────
async function reload() {
  console.log('\n🔄 Recargando asistentes en el servidor...');
  try {
    const res = await request(`${SERVER}/api/admin/reload`, 'POST', {});
    if (res.status === 200) {
      const { before, after, assistants } = res.body;
      console.log(`   ✅ ${before} → ${after} asistentes cargados`);
      assistants?.forEach(a => console.log(`      • ${a.name} (${a.id})`));
    } else {
      console.warn(`   ⚠️  Reload respondió ${res.status} — puede que el servidor aún no tenga el endpoint.`);
      console.warn(`       Reinicia el servidor manualmente si el asistente no aparece.`);
    }
  } catch (e) {
    console.warn(`   ⚠️  Reload falló: ${e.message}`);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 NodeFlow Push Assistant → ${SERVER}`);

  const all = getAssistantFiles();
  if (all.length === 0) {
    console.error('❌ No hay archivos en assistants/'); process.exit(1);
  }

  let targets;
  if (target === 'all') {
    targets = all;
    console.log(`   Subiendo todos: ${targets.map(t => t.id).join(', ')}`);
  } else {
    const found = all.find(a => a.id === target);
    if (!found) {
      console.error(`❌ No encontrado: assistants/${target}.json`);
      console.log(`   Disponibles: ${all.map(a => a.id).join(', ')}`);
      process.exit(1);
    }
    targets = [found];
  }

  let ok = 0;
  for (const t of targets) {
    const success = await pushAssistant(t.config);
    if (success) ok++;
  }

  // Reload para que aparezca sin redeploy
  await reload();

  console.log(`\n${ok === targets.length ? '✅' : '⚠️ '} ${ok}/${targets.length} asistentes subidos.`);
  if (ok > 0) console.log(`   Abre el dashboard y pulsa F5 para verlos.\n`);
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
