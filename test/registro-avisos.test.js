'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// UN CANAL DE AVISOS QUE SOLO HABLA CUANDO ALGO VA MAL NO SE DISTINGUE DE UNO ROTO
//
// En producción había dos líneas `NOTIFY_EMAIL` con direcciones distintas; manda
// la última, así que una llevaba meses sin recibir un solo aviso. Nadie se
// enteró, y no por descuido: **no había forma de enterarse**. Un buzón callado
// se parece exactamente a que todo va bien, y la avería sólo se descubre el día
// que algo se rompe — el día en que el aviso habría servido de algo.
//
// Lo que se prueba aquí es que ahora el canal deja rastro y que ese rastro sabe
// decir «esto está muerto». Sobre todo dos cosas que antes no existían:
//
//   · «aceptado» no es «entregado». Resend devuelve 200 y el rebote llega
//     minutos después; hasta hoy ese rebote se perdía y el envío constaba como
//     avisado.
//   · el SILENCIO PROLONGADO es en sí mismo un síntoma. El informe sale todas
//     las semanas: diez días sin entregar nada no es paz, es que no hay canal.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { analizar, confirmarEntregas, DIAS_DE_SILENCIO_SOSPECHOSO } = require('../src/notifications/registro-avisos');

const AHORA = 1_800_000_000_000;      // instante fijo: nada depende del reloj
const dias = n => AHORA - n * 86400_000;
const aviso = (o = {}) => ({ t: dias(1), to: ['unai@nodeflow.es'], s: 'Informe', ok: true, id: 'e1', e: null, ev: 'delivered', ...o });

test('canal sano: entregas recientes y ningún fallo', () => {
  const a = analizar([aviso({ t: dias(6), id: 'a' }), aviso({ t: dias(1), id: 'b' })], { ahora: AHORA });
  assert.equal(a.sano, true);
  assert.equal(a.fallos, 0);
  assert.equal(a.entregados, 2);
  assert.match(a.resumen, /funciona/);
});

test('«aceptado» NO es «entregado»: un rebote se ve como problema', () => {
  // Esto es lo que antes se perdía: Resend dijo 200, el envío constaba bien, y
  // el correo rebotó sin que nadie lo supiera nunca.
  const a = analizar([aviso({ t: dias(1), ok: true, ev: 'bounced' })], { ahora: AHORA });
  assert.equal(a.sano, false);
  assert.equal(a.noEntregados.length, 1);
  assert.equal(a.noEntregados[0].estado, 'bounced');
  assert.match(a.resumen, /NO llegaron/);
});

test('marcado como spam también cuenta como no entregado', () => {
  const a = analizar([aviso({ ev: 'complained' })], { ahora: AHORA });
  assert.equal(a.sano, false);
  assert.match(a.resumen, /complained/);
});

test('EL DETECTOR QUE FALTABA: demasiados días sin entregar nada', () => {
  // El informe semanal sale todos los lunes. Si la última entrega confirmada es
  // de hace tres semanas, no es que no haya noticias: es que el canal está roto.
  const a = analizar([aviso({ t: dias(21) })], { ahora: AHORA });
  assert.equal(a.sano, false);
  assert.equal(a.diasSinEntregar, 21);
  assert.match(a.resumen, /21 días sin entregar/);
});

test('el umbral no salta con el ritmo normal (semanal)', () => {
  // Un detector que denuncia el funcionamiento normal se acaba ignorando, y
  // entonces deja de avisar de lo de verdad. Con informe semanal, 8 días es
  // normal; 10 ya no.
  assert.equal(analizar([aviso({ t: dias(8) })], { ahora: AHORA }).sano, true);
  assert.equal(analizar([aviso({ t: dias(DIAS_DE_SILENCIO_SOSPECHOSO) })], { ahora: AHORA }).sano, false);
});

// ── El fallo que salió PROBÁNDOLO de verdad, no en los tests ────────────────
// La primera versión, con CERO entregas confirmadas, decía «el canal de avisos
// funciona: última entrega confirmada hace 0 día(s)». El cálculo caía al primer
// registro cuando no había ninguna entrega, así que un canal donde nada llegara
// nunca se declaraba sano mientras hubiera envíos recientes. O sea: el mismo
// silencio-que-parece-salud que este fichero viene a matar, metido dentro del
// arreglo. Y no lo cazó ningún test — lo cazó mirar la salida de la prueba real.
describe_estados_intermedios();
function describe_estados_intermedios() {
  test('enviado pero sin confirmar TODAVÍA: ni funciona ni está roto', () => {
    // Resend tarda cerca de un minuto en dar veredicto. Llamarlo fallo en esa
    // ventana sería falsa alarma; llamarlo éxito sería la mentira de siempre.
    const a = analizar([aviso({ t: AHORA - 30_000, ev: null })], { ahora: AHORA });
    assert.equal(a.entregados, 0);
    assert.equal(a.sinConfirmarTodavia, true);
    assert.equal(a.sano, true, 'no hay nada roto todavía');
    assert.doesNotMatch(a.resumen, /funciona/, 'no puede decir que funciona sin una sola entrega confirmada');
    assert.match(a.resumen, /ninguna entrega confirmada TODAV/i);
  });

  test('semanas enviando SIN una sola entrega confirmada → canal muerto', () => {
    // Este es el estado que la primera versión declaraba sano.
    const a = analizar([aviso({ t: dias(25), ev: null }), aviso({ t: dias(1), ev: null })], { ahora: AHORA });
    assert.equal(a.entregados, 0);
    assert.equal(a.sano, false);
    assert.match(a.resumen, /SIN UNA SOLA entrega confirmada/);
  });

  test('«hace 0 días» solo se dice si HAY una entrega confirmada', () => {
    assert.equal(analizar([aviso({ t: AHORA - 1000, ev: null })], { ahora: AHORA }).diasSinEntregar, null);
    assert.equal(analizar([aviso({ t: AHORA - 1000, ev: 'delivered' })], { ahora: AHORA }).diasSinEntregar, 0);
  });
}

test('un envío fallido se registra y se ve el motivo', () => {
  const a = analizar([aviso({ ok: false, ev: null, e: 'Invalid `to` field' })], { ahora: AHORA });
  assert.equal(a.fallos, 1);
  assert.equal(a.ultimosFallos[0].error, 'Invalid `to` field');
  assert.equal(a.sano, false);
});

test('el informe dice A DÓNDE van los avisos (esto es lo que no se podía ver)', () => {
  // La avería del gmail no era un fallo: era no saber que esa dirección no
  // estaba en la lista. Contra eso no vale una alarma, vale poder mirarlo.
  const a = analizar([aviso()], { ahora: AHORA, destinatarios: ['unai@nodeflow.es', '74doktorr@gmail.com'] });
  assert.deepEqual(a.destinatarios, ['unai@nodeflow.es', '74doktorr@gmail.com']);
});

test('sin ningún aviso anotado NO se declara sano', () => {
  // El caso más traicionero: registro vacío. Podría leerse como «no hay
  // problemas» y es justo al revés — o no se ha mandado nada, o el registro no
  // funciona. Las dos cosas hay que mirarlas.
  const a = analizar([], { ahora: AHORA });
  assert.equal(a.sano, false);
  assert.match(a.resumen, /no hay ni un aviso anotado/);
});

test('aguanta entradas rotas y desordenadas', () => {
  const a = analizar([null, { s: 'sin fecha' }, aviso({ t: dias(1) }), aviso({ t: dias(5) })], { ahora: AHORA });
  assert.equal(a.anotados, 2);
  assert.equal(a.ultimaEntregaConfirmada, new Date(dias(1)).toISOString());
});

describe_confirmar();
function describe_confirmar() {
  test('confirmarEntregas pregunta a Resend solo por los que aún no tienen veredicto', async () => {
    const pedidos = [];
    const store = require('../src/utils/rate-store');
    const { CLAVE } = require('../src/notifications/registro-avisos');
    await store.reset(CLAVE);
    // Uno ya confirmado, uno demasiado reciente, uno fallido, y uno que SÍ toca.
    await store.pushCapped(CLAVE, { t: AHORA - 3600_000, to: ['a@b.es'], s: 'x', ok: true, id: 'ya', ev: 'delivered' }, 300);
    await store.pushCapped(CLAVE, { t: AHORA - 10_000,   to: ['a@b.es'], s: 'x', ok: true, id: 'nuevo', ev: null }, 300);
    await store.pushCapped(CLAVE, { t: AHORA - 3600_000, to: ['a@b.es'], s: 'x', ok: false, id: null, ev: null }, 300);
    await store.pushCapped(CLAVE, { t: AHORA - 3600_000, to: ['a@b.es'], s: 'x', ok: true, id: 'toca', ev: null }, 300);

    const resend = { emails: { get: async (id) => { pedidos.push(id); return { data: { last_event: 'bounced' } }; } } };
    const r = await confirmarEntregas({ resend, ahora: AHORA });

    assert.deepEqual(pedidos, ['toca'], 'ha preguntado por los que no debía (o se ha dejado el que tocaba)');
    assert.equal(r.revisados, 1);

    // Y el veredicto queda anotado, sin perder los demás.
    const { leer } = require('../src/notifications/registro-avisos');
    const l = await leer();
    assert.equal(l.length, 4, 'se han perdido anotaciones al actualizar');
    assert.equal(l.find(x => x.id === 'toca').ev, 'bounced');
    assert.equal(l.find(x => x.id === 'ya').ev, 'delivered', 'ha tocado uno que ya estaba confirmado');
    await store.reset(CLAVE);
  });

  test('sin cliente de Resend no revienta: devuelve 0 y sigue', async () => {
    assert.deepEqual(await confirmarEntregas({ resend: null }), { revisados: 0 });
    assert.deepEqual(await confirmarEntregas({ resend: {} }), { revisados: 0 });
  });
}
