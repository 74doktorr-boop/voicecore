#!/usr/bin/env node
// ============================================================
// NodeFlow — Demo Voice Generator (ElevenLabs edition)
// eleven_multilingual_v2 → PCM 24kHz → WAV + JSON manifest
//
// Uso: node scripts/generate-demo.js
// ============================================================

require('dotenv').config();
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_KEY) { console.error('❌  ELEVENLABS_API_KEY no configurada'); process.exit(1); }

const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');

// ── Voces ElevenLabs — PREMIUM CURADAS ────────────────────────────────────────
// FUENTE DE VERDAD: config/voices.json (mismas voces que vende el selector).
// Antes el demo usaba voces de STOCK (Bella/Rachel/stock) = "lo básico"; ahora
// luce las 11 premium curadas. Se resuelven por id de catálogo para no volver a
// desincronizar (mismo principio que src/tts/voice-map.js).
const CATALOG = require('../config/voices.json').voices;
const _byId = Object.fromEntries(CATALOG.map(v => [v.id, v]));
function voice(catId, settings) {
  const v = _byId[catId];
  if (!v || !v.providerVoiceId || v.provider !== 'elevenlabs') {
    throw new Error(`Voz premium no encontrada en config/voices.json: ${catId}`);
  }
  return { id: v.providerVoiceId, name: v.name, settings };
}
const VOICES = {
  // Asistente (IA) — 3 voces premium distintas para lucir el rango por sector
  ia:          voice('cristina-es', { stability: 0.48, similarity_boost: 0.85, style: 0.28, use_speaker_boost: true }), // F recepción (default)
  iaBella:     voice('gabriela-es', { stability: 0.45, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true }), // F expresiva/vivaz (peluquería)
  iaRachel:    voice('cristina-es', { stability: 0.50, similarity_boost: 0.85, style: 0.25, use_speaker_boost: true }), // F recepción/confianza (clínica)
  iaCarlos:    voice('carlos-es',   { stability: 0.50, similarity_boost: 0.82, style: 0.30, use_speaker_boost: true }), // M profesional (restaurante)
  // Clientes — otras voces premium, distintas del asistente, más casuales
  clienteF:    voice('cora-es',   { stability: 0.38, similarity_boost: 0.72, style: 0.50, use_speaker_boost: true }),
  clienteM:    voice('alex-es',   { stability: 0.35, similarity_boost: 0.70, style: 0.48, use_speaker_boost: true }),
  clienteM2:   voice('marcos-es', { stability: 0.37, similarity_boost: 0.73, style: 0.45, use_speaker_boost: true }),
};

// ── Demos ─────────────────────────────────────────────────────────────────────
const DEMOS = [
  {
    id:    'peluqueria',
    title: 'Peluquería · Bilbao',
    icon:  '✂️',
    tag:   'peluquería',
    iaVoice: VOICES.iaBella,   // asistente: voz femenina cálida ("Soy Lucía")
    segments: [
      { speaker: 'cliente', voice: VOICES.clienteF, text: 'Buenas, mira, quería pedir cita para un corte de pelo.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: '¡Buenas! Soy Lucía, la asistente de Peluquería Adela. Claro que sí, ¿para qué día te viene bien?' },
      { speaker: 'cliente', voice: VOICES.clienteF, text: 'Pues el viernes por la tarde, si tenéis algo.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: 'El viernes tengo disponible a las cinco y cuarto, y también a las seis y media. ¿Alguna te va bien?' },
      { speaker: 'cliente', voice: VOICES.clienteF, text: 'Las cinco y cuarto, perfecto.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: '¡Genial! ¿Y me dices tu nombre para apuntarlo?' },
      { speaker: 'cliente', voice: VOICES.clienteF, text: 'Soy Ana.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: 'Listo, Ana. Cita el viernes a las cinco y cuarto. Te mando un recordatorio el jueves. ¡Hasta entonces!' },
    ],
  },
  {
    id:    'clinica',
    title: 'Clínica Dental · Donostia',
    icon:  '🦷',
    tag:   'clínica',
    iaVoice: VOICES.iaRachel,  // asistente: voz femenina profesional, distinta a la de peluquería
    segments: [
      { speaker: 'cliente', voice: VOICES.clienteM, text: 'Hola, necesitaría pedir una revisión con el dentista, por favor.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: '¡Hola! Soy la recepcionista virtual de Clínica Dental Etxe. ¿Eres paciente de la clínica o sería tu primera visita?' },
      { speaker: 'cliente', voice: VOICES.clienteM, text: 'Soy paciente. Me llamo Mikel Urrutia.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: '¡Hola, Mikel! Te encuentro en el sistema. Tengo disponible el martes a las nueve de la mañana, o el jueves a las cuatro de la tarde. ¿Cuál te viene mejor?' },
      { speaker: 'cliente', voice: VOICES.clienteM, text: 'El martes a las nueve, perfecto.' },
      { speaker: 'ia',      voice: VOICES.ia,       text: 'Anotado. Revisión el martes a las nueve con el doctor. Te llegará un recordatorio el lunes. ¡Hasta pronto, Mikel!' },
    ],
  },
  {
    id:    'restaurante',
    title: 'Restaurante · Vitoria-Gasteiz',
    icon:  '🍽️',
    tag:   'restaurante',
    iaVoice: VOICES.iaCarlos,  // asistente: voz masculina (variación de género)
    segments: [
      { speaker: 'cliente', voice: VOICES.clienteM2, text: 'Hola, buenas noches. Queríamos hacer una reserva para cenar esta noche.' },
      { speaker: 'ia',      voice: VOICES.ia,        text: '¡Buenas noches! Soy el asistente del Restaurante Txoko. ¿Cuántos seríais y a qué hora pensabais venir?' },
      { speaker: 'cliente', voice: VOICES.clienteM2, text: 'Somos cuatro personas, sobre las nueve y media.' },
      { speaker: 'ia',      voice: VOICES.ia,        text: 'Perfecto, tengo mesa disponible para cuatro a las nueve y media. ¿A qué nombre la pongo?' },
      { speaker: 'cliente', voice: VOICES.clienteM2, text: 'A nombre de Gorka.' },
      { speaker: 'ia',      voice: VOICES.ia,        text: '¡Listo, Gorka! Mesa para cuatro esta noche a las nueve y media. Cualquier cambio no dudéis en llamar. ¡Buenas noches y buen provecho!' },
    ],
  },
];

// ── ElevenLabs API ────────────────────────────────────────────────────────────
function generatePcm(text, voice) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id:      'eleven_turbo_v2_5',  // supports explicit language_code → no switching
      language_code: 'es',
      voice_settings: {
        ...voice.settings,
        style:             voice.settings.style ?? 0.3,
        use_speaker_boost: true,
      },
    });

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path:     `/v1/text-to-speech/${voice.id}?output_format=pcm_24000`,
      method:   'POST',
      headers:  {
        'xi-api-key':   ELEVENLABS_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', d => err += d);
        res.on('end', () => reject(new Error(`ElevenLabs ${res.statusCode}: ${err.slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function pcmSilence(ms) {
  return Buffer.alloc(Math.floor(24000 * ms / 1000) * 2, 0);
}

function buildWav(pcmData) {
  const SR = 24000, CH = 1, BPS = 16;
  const dataSize = pcmData.length;
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);       hdr.writeUInt32LE(36 + dataSize, 4);
  hdr.write('WAVE', 8);       hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(CH, 22);  hdr.writeUInt32LE(SR, 24);
  hdr.writeUInt32LE(SR * CH * BPS / 8, 28);
  hdr.writeUInt16LE(CH * BPS / 8, 32); hdr.writeUInt16LE(BPS, 34);
  hdr.write('data', 36);      hdr.writeUInt32LE(dataSize, 40);
  return Buffer.concat([hdr, pcmData]);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const desktopDir = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
  const demoFolder = path.join(desktopDir, 'NodeFlow Demos');
  if (!fs.existsSync(demoFolder)) fs.mkdirSync(demoFolder, { recursive: true });

  for (const demo of DEMOS) {
    console.log(`\n🎙️  Generando: ${demo.title}`);

    const chunks   = [pcmSilence(300)];
    const segments = [];
    let   nowMs    = 300;

    for (const seg of demo.segments) {
      // La asistente usa la voz propia del demo (variación por sector); el cliente, la suya.
      const segVoice = seg.speaker === 'ia' ? (demo.iaVoice || seg.voice) : seg.voice;
      process.stdout.write(`  [${seg.speaker}] (${segVoice.name}) "${seg.text.slice(0, 50)}…" `);

      const pcm   = await generatePcm(seg.text, segVoice);
      const durMs = Math.round(pcm.length / (24000 * 2) * 1000);

      segments.push({ speaker: seg.speaker, text: seg.text, startMs: nowMs, durationMs: durMs });
      chunks.push(pcm);
      nowMs += durMs;

      const pauseMs = seg.speaker === 'ia' ? 500 : 320;
      chunks.push(pcmSilence(pauseMs));
      nowMs += pauseMs;

      console.log(`${(durMs/1000).toFixed(1)}s ✓`);
      await sleep(300); // rate limit
    }

    chunks.push(pcmSilence(400));
    const totalMs = nowMs + 400;

    const wav      = buildWav(Buffer.concat(chunks));
    const wavName  = `demo-${demo.id}.wav`;
    const jsonName = `demo-${demo.id}.json`;

    // Guardar en public/audio/ (para el player web)
    fs.writeFileSync(path.join(AUDIO_DIR, wavName), wav);

    const manifest = { id: demo.id, title: demo.title, icon: demo.icon, tag: demo.tag, totalMs, segments };
    fs.writeFileSync(path.join(AUDIO_DIR, jsonName), JSON.stringify(manifest, null, 2));

    // Guardar también en Escritorio/NodeFlow Demos/ (para enviar por WA)
    fs.writeFileSync(path.join(demoFolder, wavName), wav);

    const sizeMb = (wav.length / 1024 / 1024).toFixed(1);
    console.log(`  ✅  ${wavName}  (${sizeMb} MB)  →  web + Escritorio`);
  }

  console.log(`\n✅  Demos listos!`);
  console.log(`📁  Escritorio → NodeFlow Demos\\`);
  console.log(`    demo-peluqueria.wav`);
  console.log(`    demo-clinica.wav`);
  console.log(`    demo-restaurante.wav`);
  console.log(`\n💡  Envía el WAV del sector del lead por WhatsApp como nota de voz o archivo adjunto.`);
})();
