'use strict';
// ============================================================
// NodeFlow — Códec e idioma para los proveedores de STT.
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo V5):
// El failover de STT no era una red de seguridad; era una red que PARECÍA estar
// ahí. Los proveedores de respaldo estaban mal configurados para la realidad de
// producción, así que un incidente de Deepgram no degradaba a "transcribe algo
// peor": degradaba a "transcribe RUIDO", y las métricas decían que todo iba bien.
//
// Dos fallos, los dos por asumir que el audio entrante es μ-law:
//
//  1. CÓDEC. Telnyx en España entrega **A-law**. Google hacía
//     `encoding === 'mulaw' ? 'MULAW' : 'LINEAR16'` → con A-law configuraba
//     LINEAR16, es decir, interpretaba bytes A-law comprimidos como PCM lineal
//     de 16 bits. Eso no es "peor calidad": es ruido blanco. AssemblyAI tenía
//     exactamente el mismo `? :`.
//
//  2. IDIOMA. Google exige BCP-47 ('es-ES'). El pipeline pasa 'es', 'es+gl' o
//     'es+eu' —los combos que usamos para no derivar en gallego/euskera puro—,
//     ninguno válido. La API los rechaza o los ignora.
//
// Puro y testeable: aquí no hay red ni estado.
// ============================================================

/** Nombres de códec que usa el pipeline, normalizados. */
function normalizeCodec(encoding) {
  const e = String(encoding || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (e === 'alaw' || e === 'pcma' || e === 'g711a') return 'alaw';
  if (e === 'mulaw' || e === 'ulaw' || e === 'pcmu' || e === 'g711u') return 'mulaw';
  if (e === 'linear16' || e === 'pcm' || e === 'pcms16le' || e === 's16le') return 'linear16';
  return e || null;
}

/** ¿Es un códec de telefonía de 8 kHz? (A-law y μ-law lo son) */
function isTelephonyCodec(encoding) {
  const c = normalizeCodec(encoding);
  return c === 'alaw' || c === 'mulaw';
}

/**
 * Códec → valor de `encoding` de Google Speech + su sample rate.
 * Google soporta ALAW y MULAW de forma nativa: no hay que convertir nada,
 * solo declararlo bien.
 */
function googleAudioConfig(encoding, sampleRate) {
  const c = normalizeCodec(encoding);
  if (c === 'alaw')  return { encoding: 'ALAW',  sampleRateHertz: sampleRate || 8000 };
  if (c === 'mulaw') return { encoding: 'MULAW', sampleRateHertz: sampleRate || 8000 };
  return { encoding: 'LINEAR16', sampleRateHertz: sampleRate || 16000 };
}

/** Códec → valor de `encoding` del WebSocket de AssemblyAI + sample rate. */
function assemblyAudioConfig(encoding, sampleRate) {
  const c = normalizeCodec(encoding);
  if (c === 'alaw')  return { encoding: 'pcm_alaw',  sampleRate: sampleRate || 8000 };
  if (c === 'mulaw') return { encoding: 'pcm_mulaw', sampleRate: sampleRate || 8000 };
  return { encoding: 'pcm_s16le', sampleRate: sampleRate || 16000 };
}

// Idioma del asistente → BCP-47. Los combos ('es+gl', 'es+eu') existen porque el
// modelo no sostiene gallego o euskera PUROS y deriva; el idioma base manda, que
// es además lo que ya hace Deepgram al transcribir esos combos con el modelo
// español. Aquí solo se traduce el nombre, no se cambia esa decisión.
const BCP47 = {
  es: 'es-ES', gl: 'gl-ES', eu: 'eu-ES', ca: 'ca-ES',
  en: 'en-US', fr: 'fr-FR', de: 'de-DE', pt: 'pt-PT', it: 'it-IT',
};

/**
 * 'es' → 'es-ES' · 'es+gl' → 'es-ES' · 'gl' → 'gl-ES' · 'es-ES' → 'es-ES'
 * Desconocido o vacío → 'es-ES' (el mercado real).
 */
function toBCP47(language) {
  const raw = String(language || '').trim();
  if (/^[a-z]{2}-[A-Z]{2}$/.test(raw)) return raw;         // ya venía bien
  const base = raw.toLowerCase().split(/[+_,\s-]/)[0];      // 'es+gl' → 'es'
  return BCP47[base] || 'es-ES';
}

module.exports = { normalizeCodec, isTelephonyCodec, googleAudioConfig, assemblyAudioConfig, toBCP47, BCP47 };
