// ============================================================
// VoiceCore — Resampler con anti-aliasing (2026-07-07)
// El "zumbido de microondas" de las voces incluidas: decimar 24kHz→8kHz
// sin low-pass pliega la banda 4-12kHz dentro de lo audible. El filtro
// de media móvil la atenúa; la banda de voz queda intacta.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { resampleToMulaw8k, mulawToPcm } = require('../src/utils/audio');

// Tono puro sInt16 a 24kHz.
function tone(freq, ms, sr = 24000, amp = 12000) {
  const n = Math.floor(sr * ms / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(amp * Math.sin(2 * Math.PI * freq * i / sr)), i * 2);
  }
  return buf;
}

function rms(pcm) {
  let acc = 0; const n = pcm.length / 2;
  for (let i = 0; i < n; i++) { const s = pcm.readInt16LE(i * 2); acc += s * s; }
  return Math.sqrt(acc / n);
}

describe('resampleToMulaw8k — anti-aliasing', () => {
  test('la banda de VOZ (1kHz) pasa casi intacta', () => {
    const out = mulawToPcm(resampleToMulaw8k(tone(1000, 100), 24000));
    const ratio = rms(out) / rms(tone(1000, 100));
    assert.ok(ratio > 0.8, `1kHz demasiado atenuado: ${ratio.toFixed(2)}`);
  });

  test('la banda que ALIASEA (6kHz) sale fuertemente atenuada', () => {
    // 6kHz a 24k → sin filtro aliasea a 2kHz con energía casi íntegra.
    const in6k = tone(6000, 100);
    const out6k = mulawToPcm(resampleToMulaw8k(in6k, 24000));
    const out1k = mulawToPcm(resampleToMulaw8k(tone(1000, 100), 24000));
    const rel = rms(out6k) / rms(out1k);
    assert.ok(rel < 0.5, `el aliasing de 6kHz debería quedar <50% de la voz; salió ${rel.toFixed(2)}`);
  });

  test('longitud y silencio se conservan', () => {
    const out = resampleToMulaw8k(tone(1000, 90), 24000);
    assert.ok(Math.abs(out.length - 720) <= 2, `90ms → ~720 muestras a 8k (salió ${out.length})`);
    const silence = Buffer.alloc(2400 * 2); // 100ms de silencio a 24k
    const outSil = mulawToPcm(resampleToMulaw8k(silence, 24000));
    assert.ok(rms(outSil) < 50, 'el silencio sigue siendo silencio');
  });

  test('8kHz de entrada → passthrough (solo la pérdida propia del códec mulaw)', () => {
    const in8k = tone(1000, 50, 8000);
    const out = mulawToPcm(resampleToMulaw8k(in8k, 8000));
    // El par encode/decode mulaw de la casa rinde ~0.85 por sí solo
    // (verificado con ida-vuelta directa) — el passthrough no debe añadir pérdida.
    assert.ok(rms(out) / rms(in8k) > 0.8, 'no debe perder más que el códec');
  });
});
