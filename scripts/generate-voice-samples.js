// ============================================================
// NodeFlow — Genera las muestras de voz UNA sola vez
// ------------------------------------------------------------
// Cada visitante que pulsaba ▶ en el selector de voces quemaba
// créditos de TTS regenerando la misma frase. Este script las
// sintetiza una vez (contra prod, que tiene las keys) y las deja
// en public/audio/voices/ + manifest.json; el portal las sirve
// como estáticos con coste cero.
//
// Uso:   node scripts/generate-voice-samples.js
// Env:   TTS_BASE (default https://nodeflow.es)
// Re-ejecutar tras cambiar de proveedor TTS (p.ej. al añadir
// ELEVENLABS_API_KEY) y commitear los archivos regenerados.
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

const BASE   = process.env.TTS_BASE || 'https://nodeflow.es';
const OUTDIR = path.join(__dirname, '..', 'public', 'audio', 'voices');

const SAMPLE_TEXT = {
  es: '¡Hola! Ha llamado a su negocio. Soy su asistente virtual. ¿En qué puedo ayudarle?',
  eu: 'Kaixo! Zure negozira deitu duzu. Zure laguntzaile birtuala naiz. Zertan lagundu zaitzaket?',
  gl: 'Ola! Chamou ao seu negocio. Son o seu asistente virtual. En que podo axudarlle?',
};

async function main() {
  const catalog = require('../config/voices.json');
  const voices  = catalog.voices || catalog;
  fs.mkdirSync(OUTDIR, { recursive: true });

  const manifest = {};
  let okCount = 0;

  for (const v of voices) {
    const lang = (v.language || 'es-ES').slice(0, 2);
    const text = SAMPLE_TEXT[lang] || SAMPLE_TEXT.es;
    process.stdout.write(`→ ${v.id} (${v.name}) … `);
    try {
      const res = await fetch(`${BASE}/api/demo/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: v.id, language: lang }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      const buf  = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`audio vacío (${buf.length}b)`);
      const ext  = type.includes('mpeg') ? 'mp3' : 'wav';
      const file = `${v.id}.${ext}`;
      fs.writeFileSync(path.join(OUTDIR, file), buf);
      manifest[v.id] = file;
      okCount++;
      console.log(`${file} (${Math.round(buf.length / 1024)}KB, ${res.headers.get('x-tts-provider')})`);
    } catch (e) {
      console.log(`✖ ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400)); // no atropellar el rate limit
  }

  fs.writeFileSync(path.join(OUTDIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${okCount}/${voices.length} muestras en ${OUTDIR}`);
  if (okCount < voices.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
