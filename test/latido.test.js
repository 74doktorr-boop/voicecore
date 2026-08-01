'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL LATIDO TIENE QUE SABER DECIR DE QUIÉN FUE LA CULPA
//
// El 31/07 el vigilante saltó dos veces y las dos dijo «HTTP 000». Eso admite
// tres averías con tres culpables distintos —el proceso muerto, el proceso vivo
// pero atascado, y el proceso perfecto con el problema fuera— y desde fuera se
// ven idénticas. El latido existe para separarlas, así que lo único que hay que
// probar de verdad es que SEPARA: un analizador que dijera siempre «algo pasó»
// no serviría para nada más que para tranquilizar.
//
// Todo lo de aquí es sobre `analizar()`, que es pura: sin Redis y sin esperar
// cinco minutos a que caiga un latido.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { analizar, HUECO_MS, CADA_MS } = require('../src/monitoring/latido');

const T0 = 1_800_000_000_000;   // instante fijo: nada aquí depende del reloj
// Serie normal: n latidos cada CADA_MS, mismo arranque, sin retardo.
const serie = (n, { boot = 'A', desde = T0, cada = CADA_MS, lag = 0, rss = 120 } = {}) =>
  Array.from({ length: n }, (_, i) => ({ t: desde + i * cada, b: boot, lag, rss, heap: 60, up: i * 10 }));

test('una serie sana no denuncia nada', () => {
  const a = analizar(serie(30));
  assert.equal(a.huecos.length, 0);
  assert.equal(a.reinicios.length, 0);
  assert.equal(a.picosDeRetardo.length, 0);
  assert.match(a.resumen, /fue FUERA/);
});

test('hueco con el MISMO bootId → estaba vivo, atascado', () => {
  // El proceso deja de latir 90 s y vuelve con el mismo arranque: nadie lo mató,
  // simplemente no ejecutó su temporizador. Es el caso que no se puede ver desde
  // fuera y el que explica un «conectó y no contestó».
  const s = [...serie(10), ...serie(10, { desde: T0 + 9 * CADA_MS + 90_000 })];
  const a = analizar(s);
  assert.equal(a.huecos.length, 1);
  assert.equal(a.huecos[0].segundos, 90);
  assert.match(a.huecos[0].veredicto, /VIVO/);
  assert.equal(a.reinicios.length, 0, 'no hubo reinicio: el bootId no cambió');
});

test('hueco con bootId DISTINTO → se murió y reinició', () => {
  const s = [...serie(10), ...serie(10, { boot: 'B', desde: T0 + 9 * CADA_MS + 45_000 })];
  const a = analizar(s);
  assert.equal(a.huecos.length, 1);
  assert.match(a.huecos[0].veredicto, /MURIÓ/);
  assert.equal(a.reinicios.length, 1);
  assert.equal(a.reinicios[0].de, 'A');
  assert.equal(a.reinicios[0].a, 'B');
});

test('los dos veredictos son EXCLUYENTES (si no, no sirve de nada)', () => {
  // Este es el test que da valor a los dos de arriba. Si el analizador pudiera
  // devolver el mismo veredicto en los dos casos, separarlos sería mentira.
  const atascado = analizar([...serie(5), ...serie(5, { desde: T0 + 4 * CADA_MS + 60_000 })]);
  const muerto   = analizar([...serie(5), ...serie(5, { boot: 'B', desde: T0 + 4 * CADA_MS + 60_000 })]);
  assert.notEqual(atascado.huecos[0].veredicto, muerto.huecos[0].veredicto);
});

test('el ruido normal del temporizador NO es un hueco', () => {
  // Node no clava los 10 s: con carga se va a 11, 12, 14. Un detector que llame
  // caída a eso acaba en la carpeta de ignorados, y entonces deja de avisar de
  // la de verdad. El umbral está en 2,5 latidos por eso.
  const s = serie(20, { cada: CADA_MS + 4000 });   // 14 s entre latidos
  assert.equal(analizar(s).huecos.length, 0);
  // Y justo por encima del umbral sí lo es.
  const justo = [...serie(3), { t: T0 + 2 * CADA_MS + HUECO_MS + 1000, b: 'A', lag: 0, rss: 120 }];
  assert.equal(analizar(justo).huecos.length, 1);
});

test('un pico de retardo se ve aunque no llegue a hueco', () => {
  // El aviso temprano: el bucle se atasca 3 s pero el latido sale igual. Sin
  // esto sólo se ve la avería cuando ya es caída.
  const s = serie(10);
  s[5].lag = 3200;
  const a = analizar(s);
  assert.equal(a.huecos.length, 0);
  assert.equal(a.picosDeRetardo.length, 1);
  assert.equal(a.picosDeRetardo[0].lagMs, 3200);
  assert.match(a.resumen, /se atasca a ratos/);
});

test('la memoria se resume para poder ver una fuga', () => {
  const s = serie(10).map((x, i) => ({ ...x, rss: 100 + i * 25 }));
  const a = analizar(s);
  assert.deepEqual(a.memoriaRssMb, { min: 100, max: 325, ultimo: 325 });
});

test('varios reinicios seguidos se cuentan todos (un bucle de reinicio se ve)', () => {
  const s = [
    ...serie(3, { boot: 'A' }),
    ...serie(3, { boot: 'B', desde: T0 + 3 * CADA_MS + 40_000 }),
    ...serie(3, { boot: 'C', desde: T0 + 7 * CADA_MS + 80_000 }),
  ];
  const a = analizar(s);
  assert.equal(a.reinicios.length, 2);
  assert.equal(a.huecos.length, 2);
  assert.ok(a.huecos.every(h => /MURIÓ/.test(h.veredicto)));
});

test('aguanta entradas rotas sin dejar de analizar el resto', () => {
  // Una línea a medio escribir en Redis no puede tumbar el informe justo el día
  // que hace falta.
  const s = [...serie(5), null, { b: 'A' }, { t: 'no soy un número' }, ...serie(5, { desde: T0 + 4 * CADA_MS + 10_000 })];
  const a = analizar(s);
  assert.equal(a.latidos, 10);
  assert.equal(a.huecos.length, 0);
});

test('sin latidos lo dice, en vez de inventarse que todo va bien', () => {
  const a = analizar([]);
  assert.equal(a.latidos, 0);
  assert.equal(a.desde, null);
  assert.match(a.resumen, /sin latidos/);
  assert.equal(analizar(null).latidos, 0);
});

test('los latidos desordenados se ordenan antes de buscar huecos', () => {
  // Redis los devuelve en orden, pero si alguna vez llegan mezclados, restar
  // instantes sin ordenar inventaría huecos negativos y caídas que no hubo.
  const s = serie(10);
  const revuelto = [s[4], s[0], s[9], s[2], s[7], s[1], s[3], s[8], s[5], s[6]];
  assert.equal(analizar(revuelto).huecos.length, 0);
});
