// ============================================
// VoiceCore — Audio Utilities
// mulaw ↔ PCM conversion for Twilio <-> AI pipeline
// ============================================

// mulaw decoding table (ITU-T G.711)
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildMulawTable() {
  for (let i = 0; i < 256; i++) {
    let mu = ~i & 0xff;
    let sign = mu & 0x80;
    let exponent = (mu >> 4) & 0x07;
    let mantissa = mu & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
  }
})();

/**
 * Decode mulaw buffer to 16-bit PCM
 * @param {Buffer} mulawBuffer - Raw mulaw audio bytes
 * @returns {Buffer} PCM 16-bit LE audio
 */
function mulawToPcm(mulawBuffer) {
  const pcm = Buffer.alloc(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = MULAW_DECODE_TABLE[mulawBuffer[i]];
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

/**
 * Encode 16-bit PCM to mulaw
 * @param {Buffer} pcmBuffer - PCM 16-bit LE audio
 * @returns {Buffer} mulaw encoded audio
 */
function pcmToMulaw(pcmBuffer) {
  const mulaw = Buffer.alloc(pcmBuffer.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    let sample = pcmBuffer.readInt16LE(i * 2);
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
}

/**
 * Convert a single 16-bit linear PCM sample to mulaw
 */
function linearToMulaw(sample) {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  const sign = (sample >> 8) & 0x80;

  if (sign !== 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

  sample = sample + MULAW_BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulawByte;
}

/**
 * Convert PCM 16-bit 24kHz to 8kHz mulaw (for Twilio)
 * Simple downsampling by factor of 3
 * @param {Buffer} pcm24k - PCM 16-bit LE at 24kHz
 * @returns {Buffer} mulaw at 8kHz
 */
function pcm24kToMulaw8k(pcm24k) {
  const sampleCount24k = pcm24k.length / 2;
  const sampleCount8k = Math.floor(sampleCount24k / 3);
  const mulaw = Buffer.alloc(sampleCount8k);
  
  for (let i = 0; i < sampleCount8k; i++) {
    const srcIdx = i * 3;
    // Average 3 samples for better quality
    let sum = 0;
    let count = 0;
    for (let j = 0; j < 3 && (srcIdx + j) < sampleCount24k; j++) {
      sum += pcm24k.readInt16LE((srcIdx + j) * 2);
      count++;
    }
    const sample = Math.round(sum / count);
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
}

/**
 * Convert PCM 16-bit at any sample rate to 8kHz mulaw
 * @param {Buffer} pcmBuffer - PCM 16-bit LE audio
 * @param {number} sourceSampleRate - Source sample rate
 * @returns {Buffer} mulaw at 8kHz
 */
function resampleToMulaw8k(pcmBuffer, sourceSampleRate) {
  if (sourceSampleRate === 8000) {
    return pcmToMulaw(pcmBuffer);
  }
  
  const ratio = sourceSampleRate / 8000;
  const srcSamples = pcmBuffer.length / 2;
  const dstSamples = Math.floor(srcSamples / ratio);
  const mulaw = Buffer.alloc(dstSamples);

  // ANTI-ALIASING (2026-07-07, reporte de Unai: "microondas de fondo"):
  // antes se decimaba con interpolación lineal A PELO — todo el contenido
  // entre 4kHz y sr/2 se PLEGABA dentro de la banda audible como zumbido
  // metálico. Media móvil de ancho ~ratio como low-pass barato antes de
  // decimar: atenúa fuerte la banda que aliasea sin apagar la voz. O(n·ratio).
  const half = Math.max(1, Math.floor(ratio / 2));
  for (let i = 0; i < dstSamples; i++) {
    const center = Math.floor(i * ratio);
    let acc = 0, n = 0;
    for (let j = center - half; j <= center + half; j++) {
      if (j >= 0 && j < srcSamples) { acc += pcmBuffer.readInt16LE(j * 2); n++; }
    }
    mulaw[i] = linearToMulaw(Math.round(acc / n));
  }
  return mulaw;
}

/**
 * Masteriza PCM16 para escucha en altavoces (2026-07-07, reporte Unai:
 * "las Cartesia suenan saturadas, las ElevenLabs increíbles"). El TTS crudo
 * trae picos transitorios a 0dBFS (cresta ~17dB) que hacen escupir a los
 * altavoces pequeños; el MP3 de ElevenLabs viene limitado de fábrica.
 * Compresión suave de picos (knee 55%FS, pendiente 4:1) + techo a -1dB.
 * In-place sobre una copia. PURA.
 * @param {Buffer} pcmBuffer PCM16LE
 * @returns {Buffer} PCM16LE masterizado
 */
function masterForSpeakers(pcmBuffer) {
  const KNEE = Math.round(32767 * 0.55);
  const SLOPE = 0.25;                      // 4:1 por encima del knee
  const CEIL = Math.round(32767 * 0.89);   // ~-1dBFS
  const out = Buffer.from(pcmBuffer);
  const n = out.length / 2;
  for (let i = 0; i < n; i++) {
    let s = out.readInt16LE(i * 2);
    const a = Math.abs(s);
    if (a > KNEE) {
      const compressed = KNEE + (a - KNEE) * SLOPE;
      s = Math.sign(s) * Math.min(CEIL, Math.round(compressed));
      out.writeInt16LE(s, i * 2);
    }
  }
  return out;
}

/**
 * Create WAV header for PCM audio
 * @param {number} dataSize - Size of PCM data in bytes
 * @param {number} sampleRate - Sample rate
 * @param {number} channels - Number of channels
 * @returns {Buffer} WAV header
 */
function createWavHeader(dataSize, sampleRate = 8000, channels = 1) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

/**
 * Upsample PCM 16-bit 8kHz → PCM 16-bit 16kHz (for Vonage WebSocket)
 * Uses linear interpolation between adjacent samples.
 * @param {Buffer} pcm8k - PCM 16-bit LE at 8kHz
 * @returns {Buffer} PCM 16-bit LE at 16kHz
 */
function pcm8kToPcm16k(pcm8k) {
  const samples8k = pcm8k.length / 2;
  const pcm16k = Buffer.alloc(samples8k * 4); // 2× samples, 2 bytes each
  for (let i = 0; i < samples8k; i++) {
    const s0 = pcm8k.readInt16LE(i * 2);
    const s1 = (i + 1 < samples8k) ? pcm8k.readInt16LE((i + 1) * 2) : s0;
    pcm16k.writeInt16LE(s0, i * 4);
    pcm16k.writeInt16LE(Math.round((s0 + s1) / 2), i * 4 + 2);
  }
  return pcm16k;
}

module.exports = {
  mulawToPcm,
  pcmToMulaw,
  pcm24kToMulaw8k,
  resampleToMulaw8k,
  pcm8kToPcm16k,
  createWavHeader,
  linearToMulaw,
  masterForSpeakers
};
