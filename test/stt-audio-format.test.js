// ============================================================
// NodeFlow — El failover de STT deja de ser decorativo (V5, auditoría 2026-07-29)
//
// Los proveedores de respaldo estaban mal configurados para la realidad de
// producción, así que un incidente de Deepgram no degradaba a "transcribe algo
// peor": degradaba a transcribir RUIDO — y las métricas decían que todo bien.
//
// Telnyx España entrega A-law. Google hacía `encoding === 'mulaw' ? 'MULAW' :
// 'LINEAR16'` y AssemblyAI `'pcm_mulaw' : 'pcm_s16le'`: con A-law, los dos
// declaraban PCM lineal de 16 bits sobre bytes A-law comprimidos. Y a Google se
// le mandaba 'es+gl' como si fuera un código BCP-47.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { normalizeCodec, isTelephonyCodec, googleAudioConfig, assemblyAudioConfig, toBCP47 } = require('../src/stt/audio-format');

describe('normalizeCodec', () => {
  test('reconoce los alias reales de los proveedores', () => {
    for (const a of ['alaw', 'A-law', 'PCMA', 'g711a']) assert.strictEqual(normalizeCodec(a), 'alaw', a);
    for (const u of ['mulaw', 'ulaw', 'PCMU', 'g711u']) assert.strictEqual(normalizeCodec(u), 'mulaw', u);
    for (const l of ['linear16', 'pcm', 'pcm_s16le']) assert.strictEqual(normalizeCodec(l), 'linear16', l);
  });
  test('vacío o desconocido no revienta', () => {
    assert.strictEqual(normalizeCodec(undefined), null);
    assert.strictEqual(normalizeCodec('opus'), 'opus');
  });
  test('A-law y μ-law son telefonía; PCM no', () => {
    assert.strictEqual(isTelephonyCodec('alaw'), true);
    assert.strictEqual(isTelephonyCodec('mulaw'), true);
    assert.strictEqual(isTelephonyCodec('linear16'), false);
  });
});

describe('googleAudioConfig — EL BUG', () => {
  test('A-law (lo que manda Telnyx en España) → ALAW a 8 kHz, no LINEAR16', () => {
    assert.deepStrictEqual(googleAudioConfig('alaw'), { encoding: 'ALAW', sampleRateHertz: 8000 });
  });
  test('μ-law → MULAW a 8 kHz', () => {
    assert.deepStrictEqual(googleAudioConfig('mulaw'), { encoding: 'MULAW', sampleRateHertz: 8000 });
  });
  test('lo demás sigue siendo LINEAR16 a 16 kHz', () => {
    assert.deepStrictEqual(googleAudioConfig('linear16'), { encoding: 'LINEAR16', sampleRateHertz: 16000 });
    assert.deepStrictEqual(googleAudioConfig(undefined), { encoding: 'LINEAR16', sampleRateHertz: 16000 });
  });
  test('un sample rate explícito manda', () => {
    assert.strictEqual(googleAudioConfig('alaw', 16000).sampleRateHertz, 16000);
  });
});

describe('assemblyAudioConfig — el mismo bug, el mismo arreglo', () => {
  test('A-law → pcm_alaw a 8 kHz', () => {
    assert.deepStrictEqual(assemblyAudioConfig('alaw'), { encoding: 'pcm_alaw', sampleRate: 8000 });
  });
  test('μ-law → pcm_mulaw a 8 kHz (sin regresión)', () => {
    assert.deepStrictEqual(assemblyAudioConfig('mulaw'), { encoding: 'pcm_mulaw', sampleRate: 8000 });
  });
  test('lo demás → pcm_s16le', () => {
    assert.strictEqual(assemblyAudioConfig('linear16').encoding, 'pcm_s16le');
  });
});

describe('toBCP47 — Google exige un código válido', () => {
  test('los idiomas del pipeline se traducen', () => {
    assert.strictEqual(toBCP47('es'), 'es-ES');
    assert.strictEqual(toBCP47('gl'), 'gl-ES');
    assert.strictEqual(toBCP47('eu'), 'eu-ES');
    assert.strictEqual(toBCP47('en'), 'en-US');
  });
  test('LOS COMBOS: es+gl y es+eu resuelven por el idioma base', () => {
    // Existen porque el modelo no sostiene gallego/euskera PUROS y deriva; el
    // base manda, igual que hace Deepgram con esos combos.
    assert.strictEqual(toBCP47('es+gl'), 'es-ES');
    assert.strictEqual(toBCP47('es+eu'), 'es-ES');
  });
  test('un BCP-47 que ya venía bien se respeta', () => {
    assert.strictEqual(toBCP47('es-ES'), 'es-ES');
    assert.strictEqual(toBCP47('pt-BR'), 'pt-BR');
  });
  test('vacío, nulo o desconocido → es-ES (el mercado real), nunca algo inválido', () => {
    for (const v of ['', null, undefined, 'klingon', '  ']) {
      assert.match(toBCP47(v), /^[a-z]{2}-[A-Z]{2}$/, `${JSON.stringify(v)} debe dar un BCP-47 válido`);
    }
  });
});
