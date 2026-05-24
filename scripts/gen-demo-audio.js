#!/usr/bin/env node
// ============================================================
// NodeFlow — Generador de audio demo para la landing
// Usa OpenAI TTS (nova voice) para crear public/demo.mp3
// Uso: node scripts/gen-demo-audio.js
// ============================================================

require('dotenv').config();
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('❌  OPENAI_API_KEY no encontrada en .env'); process.exit(1); }

// Guión de la llamada demo (solo la IA hablando — ~25s)
const DEMO_SCRIPT = `
Buenas tardes, gracias por llamar a Peluquería Argoitia. Soy el asistente virtual de NodeFlow.
¿En qué le puedo ayudar? Puedo reservarle una cita, informarle sobre nuestros servicios y horarios,
o responder cualquier consulta que tenga. Estoy aquí para atenderle las veinticuatro horas del día,
los siete días de la semana. Dígame, ¿qué necesita?
`.trim().replace(/\n/g, ' ');

const OUTPUT = path.join(__dirname, '..', 'public', 'demo.mp3');

const body = JSON.stringify({
  model: 'tts-1-hd',
  input: DEMO_SCRIPT,
  voice: 'nova',
  speed: 1.0,
  response_format: 'mp3',
});

console.log('🎙  Generando audio demo con OpenAI TTS (nova)…');
console.log(`📝  Texto: "${DEMO_SCRIPT.substring(0, 60)}…"`);

const req = https.request({
  hostname: 'api.openai.com',
  path: '/v1/audio/speech',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  if (res.statusCode !== 200) {
    let err = '';
    res.on('data', d => err += d);
    res.on('end', () => {
      console.error(`❌  OpenAI error ${res.statusCode}: ${err}`);
      process.exit(1);
    });
    return;
  }

  const out = fs.createWriteStream(OUTPUT);
  res.pipe(out);
  out.on('finish', () => {
    const size = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
    console.log(`✅  Audio guardado: public/demo.mp3 (${size} KB)`);
    console.log(`🔊  Abre el archivo para escucharlo y confirmar que suena bien.`);
  });
});

req.on('error', e => { console.error(`❌  Request error: ${e.message}`); process.exit(1); });
req.write(body);
req.end();
