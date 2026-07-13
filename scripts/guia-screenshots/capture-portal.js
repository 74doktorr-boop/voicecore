#!/usr/bin/env node
// Captura pantallazos limpios de cada sección del portal vía Chrome DevTools Protocol.
// Requiere: mock server en http://localhost:8378 y Chrome instalado.
// Uso: node capture-portal.js
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'public', 'guia-img');
const BASE = 'http://localhost:8378';
const PORT = 9333;
const W = 1400, H = 940, DSF = 1.0;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(p => fs.existsSync(p));

// secciones a capturar: [navId, archivo, waitMs extra]
const SECTIONS = [
  ['dashboard',        'dashboard',        1200],
  ['llamadas',         'llamadas',         1400],
  ['citas',            'citas',            1400],
  ['clientes',         'clientes',         1400],
  ['oportunidades',    'oportunidades',    1400],
  ['espera',           'espera',           1200],
  ['tareas',           'tareas',           1200],
  ['seguimientos',     'seguimientos',     1600],
  ['informes',         'informes',         1800],
  ['insights',         'insights',         1600],
  ['referidos',        'referidos',        1200],
  ['widget',           'widget',           1200],
  ['asistente',        'asistente',        1600],
  ['conocimiento',     'conocimiento',     1200],
  ['automatizaciones', 'automatizaciones', 1400],
  ['integraciones',    'integraciones',    1400],
  ['facturacion',      'facturacion',      1600],
  ['configuracion',    'configuracion',    1200],
];

const PREP = `(function(){
  try{ if(typeof closeModal==='function') closeModal(); }catch(e){}
  try{ if(navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}); }catch(e){}
  try{ localStorage.setItem('nf_tour_v1_done','1'); }catch(e){}
  ['nf-tour-ov','nf-tour-card','nf-tour-spot'].forEach(function(id){var e=document.getElementById(id); if(e)e.remove();});
  try{ document.getAnimations().forEach(function(a){ try{a.finish();}catch(e){ try{a.cancel();}catch(_){} } }); }catch(e){}
  var st=document.getElementById('nf-freeze'); if(!st){ st=document.createElement('style'); st.id='nf-freeze'; document.head.appendChild(st); }
  st.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  window.scrollTo(0,0);
  return true;
})()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!CHROME) { console.error('Chrome no encontrado'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-cdp-'));

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore' });

  // esperar al endpoint de depuración
  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const r = await fetch(`http://localhost:${PORT}/json`);
      const list = await r.json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) {}
  }
  if (!target) { console.error('No hay target CDP'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let _id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise(res => {
    const id = ++_id; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: DSF, mobile: false,
  });

  // login + carga inicial
  await send('Page.navigate', { url: `${BASE}/portal?token=demo` });
  await sleep(4500);
  await evaluate(PREP);
  await sleep(600);

  const results = [];
  for (const [nav, file, wait] of SECTIONS) {
    await evaluate(`(function(){ try{ navigate('${nav}'); }catch(e){ return 'ERR:'+e.message; } return 'ok'; })()`);
    await sleep(wait);
    await evaluate(PREP);            // congelar animaciones tardías + quitar overlay
    await sleep(350);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, captureBeyondViewport: false });
    if (shot.result && shot.result.data) {
      const buf = Buffer.from(shot.result.data, 'base64');
      const fp = path.join(OUT_DIR, file + '.jpg');
      fs.writeFileSync(fp, buf);
      results.push(`${file}.jpg  ${(buf.length/1024).toFixed(0)}KB`);
      console.log('✔', results[results.length-1]);
    } else {
      console.log('✖ fallo captura', nav);
    }
  }

  ws.close();
  chrome.kill();
  console.log('\nTOTAL', results.length, 'capturas en', OUT_DIR);
}
main().catch(e => { console.error(e); process.exit(1); });
