// ============================================================
// NodeFlow — Qué versión corre ahí fuera (auditoría 2026-07-29)
//
// El campo `sha` del endpoint de salud existe para responder a una sola
// pregunta: ¿qué commit está desplegado? Durante esta sesión demostró ser
// inútil, y de la peor manera — devolvía "undefin", que son los siete primeros
// caracteres de la cadena "undefined", y se leía como si fuera una versión.
//
// La causa se acotó comparando la imagen contra el contenedor: la imagen en
// GHCR llevaba GIT_SHA=825b8c73… y el contenedor que la ejecutaba reportaba
// otra cosa. El entorno de EasyPanel pisa la variable. Por eso el SHA pasa a
// leerse de un FICHERO grabado en el build, que el entorno no puede tocar.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { resolveSha } = require('../src/api/routes');

const SHA = '825b8c73b3fe2c2f386c79aeffcebeb3163b9d33';

describe('resolveSha', () => {
  test('el FICHERO manda sobre la variable de entorno', () => {
    // Es el orden que importa: el fichero se graba en el build y es fiable; la
    // env la puede pisar la plataforma, y de hecho lo hace.
    assert.strictEqual(resolveSha(SHA, 'aaaaaaaaaaaaaaa'), '825b8c7');
  });

  test('sin fichero, la env sirve de respaldo (desarrollo local)', () => {
    assert.strictEqual(resolveSha(null, SHA), '825b8c7');
  });

  test('EL BUG: "undefined" ya no se sirve como si fuera una versión', () => {
    assert.strictEqual(resolveSha(null, 'undefined'), 'unknown');
    assert.notStrictEqual(resolveSha(null, 'undefined'), 'undefin');
  });

  test('las demás cadenas que aparecen cuando una plantilla no resuelve', () => {
    for (const v of ['null', 'unknown', '', '   ', null, undefined]) {
      assert.strictEqual(resolveSha(null, v), 'unknown', `env=${JSON.stringify(v)}`);
    }
  });

  test('un fichero con basura no tapa a una env buena', () => {
    assert.strictEqual(resolveSha('undefined', SHA), '825b8c7');
    assert.strictEqual(resolveSha('\n', SHA), '825b8c7');
  });

  test('solo se acepta lo que PARECE un SHA', () => {
    // Sin esto, cualquier cadena de la plataforma pasaría por versión.
    assert.strictEqual(resolveSha(null, 'produccion'), 'unknown');
    assert.strictEqual(resolveSha(null, 'v2.0.0'), 'unknown');
    assert.strictEqual(resolveSha(null, 'latest'), 'unknown');
  });

  test('tolera saltos de línea y espacios del fichero', () => {
    assert.strictEqual(resolveSha(`  ${SHA}\n`, null), '825b8c7');
  });

  test('un SHA corto (7) también vale', () => {
    assert.strictEqual(resolveSha('825b8c7', null), '825b8c7');
  });

  test('cuando NO se puede saber, lo dice: una versión inventada es peor que ninguna', () => {
    assert.strictEqual(resolveSha(null, null), 'unknown');
  });
});
