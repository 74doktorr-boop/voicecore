// ============================================================
// NodeFlow — Detector de dependencias no declaradas (2026-07-29)
//
// EL CASO REAL: `src/api/data-export.js` hacía `require('jszip')` y jszip no
// estaba en package.json. Funcionaba en el portátil por casualidad de dónde
// está la carpeta — el repo vive en `scratch/voicecore` y existe
// `scratch/node_modules`, así que Node subía por el árbol y lo encontraba FUERA
// del proyecto. Dentro del contenedor no hay padre que valga: `npm ci
// --omit=dev` instala lo declarado y nada más.
//
// Resultado: la exportación completa de datos reventaba con MODULE_NOT_FOUND al
// primer clic, llevaba meses así, y la auditoría de promesas la había dado por
// VERIFICADA. El código era correcto; lo roto era el empaquetado.
//
// Un fallo así no lo cazan ni los tests ni leer el código. Solo comparar lo que
// se importa con lo que se declara.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { paquetesImportados, sinComentarios } = require('../scripts/check-deps');

describe('paquetesImportados', () => {
  test('EL CASO JSZIP: un require normal se detecta', () => {
    assert.deepStrictEqual(paquetesImportados("const JSZip = require('jszip');"), ['jszip']);
  });

  test('ignora lo relativo: eso no son dependencias', () => {
    const src = "require('./x'); require('../y/z'); require('/abs');";
    assert.deepStrictEqual(paquetesImportados(src), []);
  });

  test('ignora los módulos nativos de Node', () => {
    const src = "require('fs'); require('node:path'); require('crypto');";
    assert.deepStrictEqual(paquetesImportados(src), []);
  });

  test('un subcamino cuenta como su paquete', () => {
    assert.deepStrictEqual(paquetesImportados("require('pdf-parse/lib/pdf-parse.js')"), ['pdf-parse']);
  });

  test('los paquetes con scope conservan el scope entero', () => {
    assert.deepStrictEqual(paquetesImportados("require('@supabase/supabase-js')"), ['@supabase/supabase-js']);
    assert.deepStrictEqual(paquetesImportados("require('@deepgram/sdk/lib/x')"), ['@deepgram/sdk']);
  });

  test('también detecta `import ... from`', () => {
    assert.deepStrictEqual(paquetesImportados("import Stripe from 'stripe';"), ['stripe']);
  });

  test('no se repite un paquete importado en varios sitios', () => {
    assert.deepStrictEqual(paquetesImportados("require('ws'); const x=require('ws');"), ['ws']);
  });

  test('un require dentro de una función (lazy) cuenta igual', () => {
    // Es justo el patrón de jszip: dentro de la función, no en la cabecera.
    const src = 'async function f() { const J = require("jszip"); }';
    assert.deepStrictEqual(paquetesImportados(src), ['jszip']);
  });

  test('un require CITADO EN UN COMENTARIO no cuenta', () => {
    // Sin esto, cada explicación en un comentario sería un falso positivo, y un
    // detector que grita sin motivo se acaba ignorando.
    assert.deepStrictEqual(paquetesImportados("// antes hacíamos require('lodash')\nrequire('ws');"), ['ws']);
    assert.deepStrictEqual(paquetesImportados("/* require('moment') */ require('ws');"), ['ws']);
  });

  test('`require(variable)` se ignora: no se puede resolver, y mejor callar que inventar', () => {
    assert.deepStrictEqual(paquetesImportados('require(nombre); require(BASE + "/x");'), []);
  });

  test('rutas absolutas de Windows fuera', () => {
    assert.deepStrictEqual(paquetesImportados("require('C:\\\\repo\\\\node_modules\\\\dotenv')"), []);
  });
});

describe('sinComentarios', () => {
  test('no se come las URL (https:// lleva //)', () => {
    const src = "const u = 'https://api.telnyx.com/v2';";
    assert.ok(sinComentarios(src).includes('https://api.telnyx.com/v2'));
  });

  test('quita bloques y líneas', () => {
    assert.ok(!sinComentarios('/* fuera */ const a=1;').includes('fuera'));
    assert.ok(!sinComentarios('const a=1; // fuera').includes('fuera'));
  });
});
