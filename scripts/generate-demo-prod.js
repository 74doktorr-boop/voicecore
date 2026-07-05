#!/usr/bin/env node
// ============================================================
// NodeFlow — Demo Voice Generator (vía PROD, voces PREMIUM curadas)
// ------------------------------------------------------------
// La clave ElevenLabs del .env local es FREE y no puede usar las
// "library voices" premium por API directa (402). Prod SÍ tiene la
// clave de pago, así que sintetizamos CADA segmento contra
// nodeflow.es/api/demo/tts (mismo camino que generó los previews).
//
// Salida: un MP3 por segmento en public/audio/demo-<id>/<i>.mp3 y un
// manifiesto public/audio/demo-<id>.json con {segments:[{speaker,text,file}]}.
// El player reproduce los segmentos EN SECUENCIA (sin timing que
// desincronice: cada turno es su propio audio).
//
// Uso:  node scripts/generate-demo-prod.js
// Env:  TTS_BASE (default https://nodeflow.es)
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

const BASE      = process.env.TTS_BASE || 'https://nodeflow.es';
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');

// Voces PREMIUM curadas (ids de catálogo → config/voices.json es la fuente de verdad).
// 3 voces de asistente distintas para lucir el rango; clientes con otras premium.
const DEMOS = [
  {
    id: 'clinica', title: 'Clínica Dental · Donostia', icon: '🦷', tag: 'clínica',
    ia: 'cristina-es', cliente: 'alex-es',   // F recepción · cliente M
    segments: [
      { speaker: 'cliente', text: 'Hola, necesitaría pedir una revisión con el dentista, por favor.' },
      { speaker: 'ia',      text: '¡Hola! Soy la recepcionista virtual de Clínica Dental Etxe. ¿Eres paciente de la clínica o sería tu primera visita?' },
      { speaker: 'cliente', text: 'Soy paciente. Me llamo Mikel Urrutia.' },
      { speaker: 'ia',      text: '¡Hola, Mikel! Te encuentro en el sistema. Tengo disponible el martes a las nueve de la mañana, o el jueves a las cuatro de la tarde. ¿Cuál te viene mejor?' },
      { speaker: 'cliente', text: 'El martes a las nueve, perfecto.' },
      { speaker: 'ia',      text: 'Anotado. Revisión el martes a las nueve con el doctor. Te llegará un recordatorio el lunes. ¡Hasta pronto, Mikel!' },
    ],
  },
  {
    id: 'peluqueria', title: 'Peluquería · Bilbao', icon: '✂️', tag: 'peluquería',
    ia: 'gabriela-es', cliente: 'cora-es',   // F expresiva/vivaz · cliente F
    segments: [
      { speaker: 'cliente', text: 'Buenas, mira, quería pedir cita para un corte de pelo.' },
      { speaker: 'ia',      text: '¡Buenas! Soy Lucía, la asistente de Peluquería Adela. Claro que sí, ¿para qué día te viene bien?' },
      { speaker: 'cliente', text: 'Pues el viernes por la tarde, si tenéis algo.' },
      { speaker: 'ia',      text: 'El viernes tengo disponible a las cinco y cuarto, y también a las seis y media. ¿Alguna te va bien?' },
      { speaker: 'cliente', text: 'Las cinco y cuarto, perfecto.' },
      { speaker: 'ia',      text: '¡Genial! ¿Y me dices tu nombre para apuntarlo?' },
      { speaker: 'cliente', text: 'Soy Ana.' },
      { speaker: 'ia',      text: 'Listo, Ana. Cita el viernes a las cinco y cuarto. Te mando un recordatorio el jueves. ¡Hasta entonces!' },
    ],
  },
  {
    id: 'restaurante', title: 'Restaurante · Vitoria-Gasteiz', icon: '🍽️', tag: 'restaurante',
    ia: 'carlos-es', cliente: 'marcos-es',   // M profesional · cliente M
    segments: [
      { speaker: 'cliente', text: 'Hola, buenas noches. Queríamos hacer una reserva para cenar esta noche.' },
      { speaker: 'ia',      text: '¡Buenas noches! Soy el asistente del Restaurante Txoko. ¿Cuántos seríais y a qué hora pensabais venir?' },
      { speaker: 'cliente', text: 'Somos cuatro personas, sobre las nueve y media.' },
      { speaker: 'ia',      text: 'Perfecto, tengo mesa disponible para cuatro a las nueve y media. ¿A qué nombre la pongo?' },
      { speaker: 'cliente', text: 'A nombre de Gorka.' },
      { speaker: 'ia',      text: '¡Listo, Gorka! Mesa para cuatro esta noche a las nueve y media. Cualquier cambio no dudéis en llamar. ¡Buenas noches y buen provecho!' },
    ],
  },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tts(text, voice) {
  const res = await fetch(`${BASE}/api/demo/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, language: 'es' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${(await res.text()).slice(0, 120)})`);
  const provider = res.headers.get('x-tts-provider') || '?';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`audio vacío (${buf.length}b)`);
  const ext = (res.headers.get('content-type') || '').includes('mpeg') ? 'mp3' : 'wav';
  return { buf, ext, provider };
}

(async () => {
  for (const demo of DEMOS) {
    const dir = path.join(AUDIO_DIR, `demo-${demo.id}`);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n🎙️  ${demo.title}  (ia=${demo.ia} · cliente=${demo.cliente})`);

    const outSegs = [];
    for (let i = 0; i < demo.segments.length; i++) {
      const seg = demo.segments[i];
      const voice = seg.speaker === 'ia' ? demo.ia : demo.cliente;
      process.stdout.write(`  [${seg.speaker}] (${voice}) "${seg.text.slice(0, 42)}…" `);
      const { buf, ext, provider } = await tts(seg.text, voice);
      const fname = `${i}.${ext}`;
      fs.writeFileSync(path.join(dir, fname), buf);
      outSegs.push({ speaker: seg.speaker, text: seg.text, file: `demo-${demo.id}/${fname}` });
      console.log(`${Math.round(buf.length / 1024)}KB ${provider} ✓`);
      await sleep(350); // rate limit
    }

    const manifest = { id: demo.id, title: demo.title, icon: demo.icon, tag: demo.tag, segments: outSegs };
    fs.writeFileSync(path.join(AUDIO_DIR, `demo-${demo.id}.json`), JSON.stringify(manifest, null, 2));
    console.log(`  ✅  ${outSegs.length} segmentos → public/audio/demo-${demo.id}/`);
  }
  console.log(`\n✅  Demos premium listos (${BASE}).`);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
