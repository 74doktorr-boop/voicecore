// ============================================================
// NodeFlow — Anti-entrecortado: juntar frases cortas antes del TTS (2026-07)
// Una frase corta se reproduce antes de que se sintetice la siguiente → hueco
// audible (worstGap 1029ms medido en llamada real). coalesceForTts junta frases
// completas hasta un mínimo, salvo el PRIMER fragmento (latencia).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { coalesceForTts } = require('../src/core/voice-pipeline');

describe('coalesceForTts', () => {
  test('primer fragmento: se manda AUNQUE sea corto (latencia)', () => {
    const r = coalesceForTts(['Vale.'], 'resto', false, 90);
    assert.strictEqual(r.text, 'Vale.');
    assert.strictEqual(r.remaining, 'resto');
    assert.strictEqual(r.spoke, true);
  });

  test('ya habló el primero y el acumulado es CORTO → no manda (acumula)', () => {
    const r = coalesceForTts(['Perfecto.'], 'resto', true, 90);
    assert.strictEqual(r.text, null);      // seguir acumulando
    assert.strictEqual(r.spoke, true);     // sigue marcado como ya-habló
  });

  test('ya habló y el acumulado alcanza el mínimo → lo manda entero', () => {
    const frases = ['Perfecto, te he apuntado para el miércoles.', 'Te espero a la una en punto.'];
    const r = coalesceForTts(frases, 'cola', true, 40);
    assert.strictEqual(r.text, frases.join(' '));
    assert.strictEqual(r.remaining, 'cola');
    assert.strictEqual(r.spoke, true);
  });

  test('sin frases completas → no manda nada', () => {
    const r = coalesceForTts([], 'a medias sin punto', true, 90);
    assert.strictEqual(r.text, null);
    assert.strictEqual(r.spoke, true);
  });

  test('junta varias cortas hasta pasar el mínimo', () => {
    // Frases que solas darían hueco; juntas superan los 90 chars → se mandan.
    const cortas = ['Hola, qué tal.', 'Bienvenido a la clínica de fisioterapia del centro.',
                    'Estamos encantados de poder atenderte hoy mismo.'];
    const r = coalesceForTts(cortas, '', true, 90);
    assert.ok(r.text && r.text.length >= 90, `manda el bloque juntado (${r.text && r.text.length})`);
  });
});
