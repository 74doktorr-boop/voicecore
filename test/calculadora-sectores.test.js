'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA CALCULADORA NO PUEDE VOLVER A SER UNA TABLA DE RESULTADOS INVENTADOS
//
// Las 26 páginas de sector enseñaban un bloque con pinta de datos medidos:
// «Impacto mensual · despacho de abogados típico — Consultas captadas +88%,
// Clientes perdidos −85%», rematado con «Estimaciones basadas en despachos con
// 1-5 profesionales en Bizkaia y Gipuzkoa». No existen tales despachos: en
// producción hay cuatro organizaciones y las cuatro son propias.
//
// Lo peor no era el número: era el FORMATO. Un porcentaje dentro de una barra
// de progreso parece medido aunque no lo esté, y por eso hacía más daño que la
// misma mentira escrita en un párrafo.
//
// Ahora quien pone los números es el visitante. Este test vigila que siga así.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'hementxe') paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');

test('no vuelve ninguna tabla de impacto con cifras inventadas', () => {
  const hits = paginas().filter(f => fs.readFileSync(f, 'utf8').includes('<div class="roi-chart">')).map(rel);
  assert.deepEqual(hits, [],
    'Vuelven las barras de «Impacto mensual» con porcentajes que nadie ha medido:\n  ' + hits.join('\n  '));
});

test('no vuelve la procedencia inventada', () => {
  // «Estimaciones basadas en despachos con 1-5 profesionales en Bizkaia y
  // Gipuzkoa» es una fuente falsa con formato de nota al pie.
  const RE = /(Estimaciones basadas en|Datos estimados para|Datos basados en) (despachos|clínicas|peluquerías|talleres|academias|gimnasios|ópticas|centros|farmacias|hoteles|autoescuelas|agencias)/i;
  const hits = paginas().filter(f => RE.test(fs.readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(hits, [], 'Procedencia inventada de vuelta:\n  ' + hits.join('\n  '));
});

test('las 27 páginas tienen la calculadora y su fuente citada', () => {
  const conCalc = paginas().filter(f => fs.readFileSync(f, 'utf8').includes('<div class="calc">'));
  assert.equal(conCalc.length, 27, `Deberían ser 27 calculadoras y hay ${conCalc.length}`);
  const sinFuente = conCalc.filter(f => !fs.readFileSync(f, 'utf8').includes('Invoca')).map(rel);
  assert.deepEqual(sinFuente, [],
    'Calculadoras cuyo 27% de partida ya no dice de dónde sale. Un dato sin ' +
    `fuente dentro de una calculadora sigue siendo un dato sin fuente:\n  ${sinFuente.join('\n  ')}`);
});

test('el ejemplo por defecto CUADRA', () => {
  // Lo escribí a mano y me equivoqué: puse 2.376 € donde salían 2.160. Es el
  // mismo pecado que llevo toda la sesión persiguiendo, cometido dentro del
  // arreglo. Ahora la cuenta se comprueba aquí, y además el JS recalcula al
  // cargar para que la cifra la haga la máquina y no yo.
  const f = paginas().find(p => fs.readFileSync(p, 'utf8').includes('<div class="calc">'));
  const h = fs.readFileSync(f, 'utf8');
  const L = 20, P = 27, C = 30, V = 60;
  const mes = L * 22;
  const perdidas = Math.round(mes * P / 100);
  const clientes = Math.round(perdidas * C / 100);
  const euros = clientes * V;
  assert.equal(euros, 2160, 'la aritmética de referencia ha cambiado');
  assert.ok(h.includes('2.160 €'),
    'El ejemplo escrito en el HTML no coincide con lo que sale de la fórmula. ' +
    'Es lo que ve todo el que no toca ningún campo, y todo el que no ejecuta JS.');
  assert.ok(h.includes('>440 al mes<') || h.includes('<b>440 al mes</b>'), 'el paso intermedio tampoco cuadra');
});

test('la calculadora recalcula al cargar, no se fía del HTML escrito a mano', () => {
  const f = paginas().find(p => fs.readFileSync(p, 'utf8').includes('<div class="calc">'));
  const h = fs.readFileSync(f, 'utf8');
  // Se busca la llamada suelta a calc() antes de cerrar la IIFE. La primera
  // versión exigía que estuviera a menos de 200 caracteres del forEach y el
  // comentario que hay en medio es más largo: el test fallaba con el código
  // correcto delante. Un test que pide una distancia arbitraria no comprueba
  // lo que dice comprobar.
  assert.match(h, /\bcalc\(\);\s*\}\)\(\);/,
    'Ya no se recalcula al cargar: lo que vería el visitante es lo que alguien ' +
    'dejó escrito a mano, que es exactamente como se coló el error de 2.376 €.');
});
