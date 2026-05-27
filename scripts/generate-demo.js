#!/usr/bin/env node
// ============================================================
// NodeFlow — Demo Voice Generator
// Genera 3 audios de demostración con OpenAI TTS (tts-1-hd)
// PCM → WAV + JSON manifest con timestamps por segmento
//
// Uso: node scripts/generate-demo.js
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');

// ── Conversaciones demo ────────────────────────────────────────────────────
const DEMOS = [
  {
    id:       'peluqueria',
    title:    'Peluquería · Bilbao',
    icon:     '✂️',
    tag:      'peluquería',
    segments: [
      { speaker: 'cliente', voice: 'alloy',  text: 'Buenas, llamo para reservar una cita para un corte de pelo.' },
      { speaker: 'ia',      voice: 'nova',   text: '¡Hola! Soy la asistente virtual de Peluquería Adela. Con mucho gusto te ayudo. ¿Para qué día necesitas la cita?' },
      { speaker: 'cliente', voice: 'alloy',  text: '¿Tenéis algo el viernes por la tarde?' },
      { speaker: 'ia',      voice: 'nova',   text: 'El viernes tenemos disponible a las cinco y cuarto y a las seis y media. ¿Cuál te viene mejor?' },
      { speaker: 'cliente', voice: 'alloy',  text: 'Las cinco y cuarto, perfecto.' },
      { speaker: 'ia',      voice: 'nova',   text: '¿Me puedes decir tu nombre para apuntarte?' },
      { speaker: 'cliente', voice: 'alloy',  text: 'Soy Ana.' },
      { speaker: 'ia',      voice: 'nova',   text: 'Perfecto, Ana. Cita confirmada para el viernes a las cinco y cuarto. ¡Te esperamos!' },
    ],
  },
  {
    id:       'clinica',
    title:    'Clínica Dental · Donostia',
    icon:     '🦷',
    tag:      'clínica',
    segments: [
      { speaker: 'cliente', voice: 'echo',   text: 'Hola, necesito pedir una revisión con el dentista.' },
      { speaker: 'ia',      voice: 'nova',   text: '¡Hola! Soy la recepcionista virtual de Clínica Dental Etxe. ¿Eres paciente habitual o es tu primera visita?' },
      { speaker: 'cliente', voice: 'echo',   text: 'Soy paciente habitual. Me llamo Mikel Urrutia.' },
      { speaker: 'ia',      voice: 'nova',   text: 'Hola Mikel. Tenemos disponible el martes a las nueve de la mañana o el jueves a las cuatro de la tarde. ¿Cuál te va mejor?' },
      { speaker: 'cliente', voice: 'echo',   text: 'El martes a las nueve me va bien.' },
      { speaker: 'ia',      voice: 'nova',   text: 'Anotado, Mikel. Revisión el martes a las nueve. Te enviaremos un recordatorio el día anterior. ¡Hasta pronto!' },
    ],
  },
  {
    id:       'restaurante',
    title:    'Restaurante · Vitoria-Gasteiz',
    icon:     '🍽️',
    tag:      'restaurante',
    segments: [
      { speaker: 'cliente', voice: 'onyx',   text: 'Hola, quería hacer una reserva para cenar esta noche.' },
      { speaker: 'ia',      voice: 'nova',   text: '¡Hola! Soy el asistente virtual del Restaurante Txoko. ¿Para cuántas personas y a qué hora?' },
      { speaker: 'cliente', voice: 'onyx',   text: 'Somos cuatro personas, sobre las nueve y media.' },
      { speaker: 'ia',      voice: 'nova',   text: 'Perfecto, tenemos mesa disponible para cuatro a las nueve y media. ¿A nombre de quién hago la reserva?' },
      { speaker: 'cliente', voice: 'onyx',   text: 'A nombre de Gorka.' },
      { speaker: 'ia',      voice: 'nova',   text: 'Reserva confirmada, Gorka. Mesa para cuatro esta noche a las nueve y media. ¡Les esperamos!' },
    ],
  },
];

// ── Audio helpers ───────────────────────────────────────────────────────────
async function generatePcm(text, voice) {
  const res = await openai.audio.speech.create({
    model:           'tts-1-hd',
    voice,
    input:           text,
    response_format: 'pcm',   // raw 16-bit signed LE, 24000 Hz, mono
    speed:           0.97,
  });
  return Buffer.from(await res.arrayBuffer());
}

function pcmSilence(ms) {
  // 24000 samples/s × 2 bytes/sample
  return Buffer.alloc(Math.floor(24000 * ms / 1000) * 2, 0);
}

function buildWav(pcmData) {
  const SR = 24000, CH = 1, BPS = 16;
  const dataSize = pcmData.length;
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);       hdr.writeUInt32LE(36 + dataSize, 4);
  hdr.write('WAVE', 8);       hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);  hdr.writeUInt16LE(1, 20);      // PCM
  hdr.writeUInt16LE(CH, 22);  hdr.writeUInt32LE(SR, 24);
  hdr.writeUInt32LE(SR * CH * BPS / 8, 28);
  hdr.writeUInt16LE(CH * BPS / 8, 32); hdr.writeUInt16LE(BPS, 34);
  hdr.write('data', 36);      hdr.writeUInt32LE(dataSize, 40);
  return Buffer.concat([hdr, pcmData]);
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

  for (const demo of DEMOS) {
    console.log(`\n🎙️  Generating: ${demo.id}`);

    const chunks   = [pcmSilence(300)];  // 300ms leading silence
    const segments = [];
    let   nowMs    = 300;

    for (const seg of demo.segments) {
      process.stdout.write(`  [${seg.speaker}] "${seg.text.slice(0, 55)}..." `);

      const pcm       = await generatePcm(seg.text, seg.voice);
      const durMs     = Math.round(pcm.length / (24000 * 2) * 1000);

      segments.push({ speaker: seg.speaker, text: seg.text, startMs: nowMs, durationMs: durMs });
      chunks.push(pcm);
      nowMs += durMs;

      // Natural pause: shorter after client, longer after IA
      const pauseMs = seg.speaker === 'ia' ? 550 : 350;
      chunks.push(pcmSilence(pauseMs));
      nowMs += pauseMs;

      console.log(`${durMs}ms ✓`);
    }

    // Trailing silence
    chunks.push(pcmSilence(400));
    const totalMs = nowMs + 400;

    // Write WAV
    const wav = buildWav(Buffer.concat(chunks));
    fs.writeFileSync(path.join(AUDIO_DIR, `demo-${demo.id}.wav`), wav);
    console.log(`  ✓ public/audio/demo-${demo.id}.wav  (${(wav.length / 1024).toFixed(0)} KB)`);

    // Write JSON manifest (for player timing)
    const manifest = {
      id:       demo.id,
      title:    demo.title,
      icon:     demo.icon,
      tag:      demo.tag,
      totalMs,
      segments,
    };
    fs.writeFileSync(
      path.join(AUDIO_DIR, `demo-${demo.id}.json`),
      JSON.stringify(manifest, null, 2)
    );
    console.log(`  ✓ public/audio/demo-${demo.id}.json`);
  }

  console.log('\n✅  All demos generated!\n');
})();
