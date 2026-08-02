'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NADA LLEGA A «TODOS LOS CLIENTES» SIN QUE LO DECIDA UNA PERSONA
//
// Una regla en el sector 'global' se inyecta en el prompt de TODOS los negocios.
// Hasta el 02/08 se llegaba ahí por dos caminos y los dos eran automáticos:
//
//   · el agregador escribía en 'global' las reglas de todos los clientes
//     mezcladas — o sea, aprendidas de UNO y propuestas para TODOS;
//   · y `sector || 'global'` mandaba ahí cualquier regla sin sector.
//
// Lo que había en la cola de aprobación el día que se miró:
//
//     [global] Proporcionar información sobre el precio del cobre
//
// Aprendida de un chatarrero, esperando a aplicarse a las clínicas de
// fisioterapia. Con 9 apariciones, la segunda más frecuente de la lista, o sea
// la que más papeletas tenía de aprobarse de un vistazo.
//
// La regla de fondo es la del charter, aplicada al ALCANCE en vez de al dinero:
// un dato que falta no puede convertirse en la opción más amplia posible.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LR = require('../src/lifecycle/learned-rules');

/** Base de mentira que apunta lo que se le pide insertar. */
function baseFalsa() {
  const insertados = [];
  const tabla = {
    select: () => tabla, eq: () => tabla,
    maybeSingle: async () => ({ data: null }),
    insert: async (fila) => { insertados.push(fila); return { error: null }; },
    update: () => tabla,
  };
  return { insertados, db: { enabled: true, client: { from: () => tabla } } };
}

test('un sector vacío NO acaba en global', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(LR._sectorSeguro(v), LR.SIN_CLASIFICAR,
      `un sector ${JSON.stringify(v)} se aplicaría a todos los clientes`);
  }
});

test('pedir «global» explícitamente TAMPOCO cuela', () => {
  // Se cierra en el borde a propósito: da igual quién llame ni desde dónde. Un
  // guardarraíl que depende de que todos los llamantes se porten bien no es un
  // guardarraíl.
  assert.equal(LR._sectorSeguro('global'), LR.SIN_CLASIFICAR);
});

test('un sector de verdad se respeta', () => {
  assert.equal(LR._sectorSeguro('fisioterapia'), 'fisioterapia');
  assert.equal(LR._sectorSeguro('chatarra'), 'chatarra');
});

test('guardar candidatas sin sector las deja en sin-clasificar', async () => {
  const { insertados, db } = baseFalsa();
  await LR.upsertCandidates(null, [{ rule: 'Dar el precio del cobre', count: 9 }], { db });
  assert.equal(insertados.length, 1);
  assert.equal(insertados[0].sector, LR.SIN_CLASIFICAR,
    'la regla del chatarrero volvería a proponerse para TODOS los clientes');
});

test('EL CASO REAL: el agregador ya no escribe en global', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src/lifecycle/improvement-aggregator.js'), 'utf8');
  assert.doesNotMatch(src, /upsertCandidates\(\s*'global'/,
    'el agregador vuelve a proponer para TODOS las reglas mezcladas de todos');
  assert.match(src, /upsertCandidates\(LR\.SIN_CLASIFICAR/);
});

test('sin-clasificar NO se inyecta en el prompt de nadie', async () => {
  // Es lo que hace que el cubo sea seguro: se puede acumular sin consecuencias.
  // Si se inyectara, moverlo ahí solo habría cambiado el nombre del problema.
  const db = {
    enabled: true,
    client: { from: () => ({ select: () => ({ eq: async () => ({ data: [
      { sector: LR.SIN_CLASIFICAR, text: 'NO DEBE APARECER' },
      { sector: 'fisioterapia', text: 'sí aparece' },
    ] }) }) }) },
  };
  const bloque = await LR.activeRulesBlock('fisioterapia', { db });
  assert.ok(!bloque.includes('NO DEBE APARECER'),
    'las reglas sin clasificar se están inyectando: el cubo no aísla nada');
  assert.ok(bloque.includes('sí aparece'));
});
