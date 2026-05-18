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
  
  for (let i = 0; i < dstSamples; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;
    
    // Linear interpolation
    let sample;
    if (srcIdx + 1 < srcSamples) {
      const s1 = pcmBuffer.readInt16LE(srcIdx * 2);
      const s2 = pcmBuffer.readInt16LE((srcIdx + 1) * 2);
      sample = Math.round(s1 + frac * (s2 - s1));
    } else {
      sample = pcmBuffer.readInt16LE(srcIdx * 2);
    }
    
    mulaw[i] = linearToMulaw(sample);
  }
  return mulaw;
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

module.exports = {
  mulawToPcm,
  pcmToMulaw,
  pcm24kToMulaw8k,
  resampleToMulaw8k,
  createWavHeader,
  linearToMulaw
};
