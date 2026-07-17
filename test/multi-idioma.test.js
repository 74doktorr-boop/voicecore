// ============================================================
// NodeFlow — Multi-idioma inglés/francés en voz (2026-07-17)
// Crítica sectorial (turismo/costa: hotel, restaurante, viajes, ~8-12 sectores).
// El asistente puede configurarse en en/fr o BILINGÜE (es+en / es+fr), y el STT
// bilingüe con en/fr usa el modelo multilingüe de Deepgram. Base es/eu/gl intacta.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');
const { _recognitionLang } = require('../src/stt/deepgram');

describe('prompt — instrucción de idioma', () => {
  test('en → responde solo en inglés', () => {
    assert.match(generatePrompt({ sector: 'hotel', language: 'en' }, 'Hotel X'), /exclusively in English/i);
  });
  test('fr → responde solo en francés', () => {
    assert.match(generatePrompt({ sector: 'hotel', language: 'fr' }, 'Hôtel X'), /exclusivement en français/i);
  });
  test('es+en → bilingüe según el cliente', () => {
    const p = generatePrompt({ sector: 'restaurante', language: 'es+en' }, 'Rest X');
    assert.match(p, /Spanish or English/i);
  });
  test('es+fr → bilingüe español/francés', () => {
    assert.match(generatePrompt({ sector: 'hotel', language: 'es+fr' }, 'Hôtel X'), /espagnol ou français/i);
  });
  test('sin idioma → español de España (intacto)', () => {
    assert.match(generatePrompt({ sector: 'dental' }, 'Clínica X'), /español de España/i);
  });
  test('gl sigue intacto', () => {
    assert.match(generatePrompt({ sector: 'peluqueria', language: 'gl' }, 'X'), /gallego/i);
  });
});

describe('STT — idioma de reconocimiento (Deepgram)', () => {
  test('en → en, fr → fr', () => {
    assert.strictEqual(_recognitionLang('en'), 'en');
    assert.strictEqual(_recognitionLang('fr'), 'fr');
  });
  test('bilingüe con inglés/francés → multi', () => {
    assert.strictEqual(_recognitionLang('es+en'), 'multi');
    assert.strictEqual(_recognitionLang('es+fr'), 'multi');
  });
  test('base intacta: es→es, eu→eu, gl→es, es+gl→es, es+eu→es', () => {
    assert.strictEqual(_recognitionLang('es'), 'es');
    assert.strictEqual(_recognitionLang('eu'), 'eu');
    assert.strictEqual(_recognitionLang('gl'), 'es');
    assert.strictEqual(_recognitionLang('es+gl'), 'es');
    assert.strictEqual(_recognitionLang('es+eu'), 'es');
  });
  test('sin idioma → es', () => assert.strictEqual(_recognitionLang(null), 'es'));
});
