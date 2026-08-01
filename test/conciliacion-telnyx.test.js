'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// UNA LLAMADA PERDIDA Y UNA HORA TRANQUILA SE VEN IGUAL — HASTA AHORA
//
// El 01/08 el anfitrión se quedó inalcanzable dos veces. Durante esos minutos
// Telnyx no alcanza el webhook y la llamada se cae, y nosotros nos enteramos por
// NADA: `nf_calls` solo tiene las llamadas cuyo webhook sí llegó. En todos
// nuestros paneles, perder una llamada y no recibir ninguna son el mismo dibujo.
//
// Para un producto que se vende diciendo «no pierdas ninguna llamada», eso es
// insostenible: la frase no era comprobable ni por nosotros. Y no hace falta una
// caída — un fallo de Telnyx, un número mal enrutado o un tope de concurrencia
// producen el mismo silencio.
//
// Telnyx sí las vio todas. Cruzar sus registros con los nuestros convierte el
// silencio en una lista de números a los que devolver la llamada.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { cruzar, conciliar, _tel } = require('../src/lifecycle/conciliacion-telnyx');

const T = Date.parse('2026-08-01T10:00:00.000Z');
const iso = ms => new Date(ms).toISOString();
const enTelnyx = (o = {}) => ({ from: '+34600111222', to: '+34943111222', started_at: iso(T), duration_millis: 45000, direction: 'inbound', ...o });
const nuestra  = (o = {}) => ({ caller_number: '+34600111222', called_number: '+34943111222', started_at: iso(T), ...o });

test('lo que atendimos se concilia y no denuncia nada', () => {
  const r = cruzar([enTelnyx()], [nuestra()]);
  assert.equal(r.conciliadas, 1);
  assert.equal(r.perdidas.length, 0);
  assert.match(r.resumen, /todas atendidas/);
});

test('LA QUE IMPORTA: Telnyx la vio y nosotros no → llamada perdida', () => {
  const r = cruzar([enTelnyx()], []);
  assert.equal(r.perdidas.length, 1);
  assert.equal(r.perdidas[0].de, '+34600111222');
  assert.equal(r.perdidas[0].cuando, iso(T));
  assert.match(r.resumen, /1 de 1 llamadas NO se atendieron/);
});

test('se empareja por número e instante, NO por identificador', () => {
  // Cuando el webhook no llega nunca hemos visto el id de Telnyx. Emparejar por
  // id daría TODAS por perdidas — justo el caso que hay que detectar bien.
  const r = cruzar([enTelnyx({ call_leg_id: 'abc-123' })], [nuestra()]);
  assert.equal(r.perdidas.length, 0);
});

test('tolera el desfase entre el CDR y nuestro reloj, pero no cualquier cosa', () => {
  assert.equal(cruzar([enTelnyx()], [nuestra({ started_at: iso(T + 90_000) })]).perdidas.length, 0, '90s debe conciliar');
  assert.equal(cruzar([enTelnyx()], [nuestra({ started_at: iso(T + 600_000) })]).perdidas.length, 1, '10 min NO es la misma llamada');
});

test('dos llamadas seguidas del mismo número se emparejan con la MÁS CERCANA', () => {
  // Con «la primera que encaje», la segunda de Telnyx podía casar con la primera
  // nuestra y dejar como perdida una que sí atendimos. Falso positivo, y de los
  // que queman la confianza en el número.
  const r = cruzar(
    [enTelnyx({ started_at: iso(T) }), enTelnyx({ started_at: iso(T + 100_000) })],
    [nuestra({ started_at: iso(T + 100_000) }), nuestra({ started_at: iso(T) })],
  );
  assert.equal(r.conciliadas, 2);
  assert.equal(r.perdidas.length, 0);
});

test('una nuestra no se puede usar para conciliar DOS de Telnyx', () => {
  const r = cruzar([enTelnyx(), enTelnyx({ started_at: iso(T + 30_000) })], [nuestra()]);
  assert.equal(r.conciliadas, 1);
  assert.equal(r.perdidas.length, 1, 'la segunda entrada de Telnyx sigue sin atender');
});

test('números escritos de otra forma se comparan igual', () => {
  // Telnyx y nuestra BD no siempre guardan el mismo formato; comparar en crudo
  // convertiría cada diferencia de formato en una llamada perdida inventada.
  const r = cruzar(
    [enTelnyx({ from: '+34 600 111 222', to: '(+34) 943-111-222' })],
    [nuestra({ caller_number: '34600111222', called_number: '+34943111222' })],
  );
  assert.equal(r.perdidas.length, 0);
  assert.equal(_tel('600 111 222'), '+600111222');
  assert.equal(_tel(null), '');
});

test('distinto número llamante NO se concilia', () => {
  const r = cruzar([enTelnyx({ from: '+34600999999' })], [nuestra()]);
  assert.equal(r.perdidas.length, 1);
});

test('también se cuenta lo contrario: nuestras que Telnyx no ve', () => {
  // Raro, pero si aparece es que la ventana está mal o hay algo que no
  // entendemos — y en los dos casos hay que saberlo ANTES de fiarse del número.
  const r = cruzar([], [nuestra(), nuestra({ started_at: iso(T + 500_000) })]);
  assert.equal(r.soloNuestras, 2);
});

test('sin datos de Telnyx no se declara nada perdido', () => {
  // Fail-safe: si la API falla o la ventana está vacía, lo peor sería inventar
  // una lista de llamadas perdidas y mandar al dueño a devolver llamadas que no
  // existieron.
  const r = cruzar([], [nuestra()]);
  assert.equal(r.perdidas.length, 0);
  assert.match(r.resumen, /no reporta ninguna llamada/);
  assert.equal(cruzar(null, null).perdidas.length, 0);
});

test('las entradas con fecha ilegible se descartan sin romper', () => {
  const r = cruzar([enTelnyx({ started_at: 'ayer por la tarde' }), enTelnyx()], [nuestra({ started_at: null })]);
  assert.equal(r.deTelnyx, 2);
  assert.equal(r.nuestras, 0);
  assert.equal(r.perdidas.length, 1);
});

test('conciliar() pide la ventana correcta y no la de ahora mismo', async () => {
  // El CDR tarda en aparecer: preguntar por lo que acaba de pasar daría falsos
  // perdidos, que es el error más caro de todos aquí.
  let pedida = null;
  const r = await conciliar({
    traerDeTelnyx: async (o) => { pedida = o; return [enTelnyx()]; },
    traerNuestras: async () => [],
  });
  const margen = Date.now() - Date.parse(pedida.hasta.toISOString());
  assert.ok(margen >= 9 * 60_000, `la ventana llega hasta hace ${Math.round(margen / 60000)} min: demasiado reciente`);
  const duracion = pedida.hasta - pedida.desde;
  assert.equal(duracion, 6 * 3600 * 1000);
  assert.equal(r.perdidas.length, 1);
  assert.ok(r.ventana.desde && r.ventana.hasta);
});

test('sólo se miran las ENTRANTES: una saliente nuestra no es una perdida', () => {
  // Las campañas de reactivación llaman hacia fuera. Sin este filtro, cada
  // llamada saliente aparecería como una entrante que no cogimos.
  const r = cruzar([enTelnyx({ direction: 'outbound' })], []);
  // cruzar() no filtra dirección —lo hace traerDeTelnyx— así que aquí se
  // comprueba que el filtro está donde toca, no que se cuele por dos sitios.
  assert.equal(r.perdidas.length, 1, 'cruzar no filtra: el filtro vive en traerDeTelnyx');
});

// ── El tipo de registro de Telnyx, que no acepta el obvio ───────────────────
// Probado contra producción: `record_type=voice` da «10011 No matching record
// type». Su nomenclatura ha cambiado entre versiones, así que en vez de adivinar
// a base de despliegues se prueban los candidatos y se recuerda el que va.
test('prueba varios record_type hasta dar con el que Telnyx acepta', async () => {
  const { traerDeTelnyx } = require('../src/lifecycle/conciliacion-telnyx');
  const pedidos = [];
  const fetchFalso = async (url) => {
    const t = decodeURIComponent(url).match(/record_type\]=([^&]+)/)[1];
    pedidos.push(t);
    if (t !== 'call') {
      return { ok: false, status: 400, text: async () => '{"errors":[{"code":"10011","detail":"No matching record type was found matching given record type"}]}' };
    }
    return { ok: true, json: async () => ({ data: [{ direction: 'inbound', from: '+1', to: '+2', started_at: new Date().toISOString() }], meta: { total_pages: 1 } }) };
  };
  const r = await traerDeTelnyx({ desde: new Date(0), hasta: new Date(), apiKey: 'k', fetch: fetchFalso });
  assert.equal(r.length, 1);
  assert.ok(pedidos.length >= 1 && pedidos.includes('call'), `probó: ${pedidos.join(', ')}`);
});

test('un 401 NO se reintenta con otros tipos: no se arregla cambiando de nombre', async () => {
  // Reintentar cinco veces contra el proveedor por un problema de credenciales
  // es maleducado y además tapa el error de verdad, que es el que hay que ver.
  const { traerDeTelnyx } = require('../src/lifecycle/conciliacion-telnyx');
  let intentos = 0;
  const fetchFalso = async () => { intentos++; return { ok: false, status: 401, text: async () => 'Authentication failed' }; };
  await assert.rejects(
    () => traerDeTelnyx({ desde: new Date(0), hasta: new Date(), apiKey: 'mala', fetch: fetchFalso, tipo: undefined }),
    /401/);
  assert.equal(intentos, 1, `ha reintentado ${intentos} veces un fallo de credenciales`);
});

test('solo se quedan las ENTRANTES', async () => {
  const { traerDeTelnyx } = require('../src/lifecycle/conciliacion-telnyx');
  const fetchFalso = async () => ({ ok: true, json: async () => ({
    data: [
      { direction: 'inbound',  from: '+1', to: '+2', started_at: '2026-08-01T10:00:00Z' },
      { direction: 'outbound', from: '+2', to: '+3', started_at: '2026-08-01T10:01:00Z' },
    ], meta: { total_pages: 1 } }) });
  const r = await traerDeTelnyx({ desde: new Date(0), hasta: new Date(), apiKey: 'k', fetch: fetchFalso, tipo: 'call' });
  assert.equal(r.length, 1);
  assert.equal(r[0].direction, 'inbound');
});

// ── Los campos REALES de un CDR de Telnyx ──────────────────────────────────
// No son los que supuse. Estos nombres salen de una respuesta de producción del
// 01/08, no de la documentación ni de mi memoria.
test('un CDR real de Telnyx se traduce bien', async () => {
  const { traerDeTelnyx } = require('../src/lifecycle/conciliacion-telnyx');
  const cdrReal = {
    record_type: 'call-control', direction: 'inbound',
    cli: '+34666351319', cld: '+34843700849',
    caller_number: '+34666351319', dest_number: '+34843700849',
    started_at: '2026-07-29T03:33:32.000Z', finished_at: '2026-07-29T03:34:20.000Z',
    call_sec: 48, billed_sec: 60, connected: true, completed: true, attempted: true,
    cost: '0.0072', currency: 'USD', connection_name: 'voicecore',
  };
  const r = await traerDeTelnyx({ desde: new Date(0), hasta: new Date(), apiKey: 'k', tipo: 'call-control',
    fetch: async () => ({ ok: true, json: async () => ({ data: [cdrReal], meta: { total_pages: 1 } }) }) });
  assert.equal(r.length, 1);
  assert.equal(r[0].from, '+34666351319');
  assert.equal(r[0].to, '+34843700849');
  assert.equal(r[0].started_at, '2026-07-29T03:33:32.000Z');
  assert.equal(r[0].duration_millis, 48000, 'call_sec son SEGUNDOS, no milisegundos');
});

test('connected:false se conserva como causa: no se atendió', async () => {
  // Distingue «no llegó el webhook» de «colgaron antes de descolgar», que no es
  // lo mismo ni es culpa nuestra.
  const { traerDeTelnyx, cruzar } = require('../src/lifecycle/conciliacion-telnyx');
  const r = await traerDeTelnyx({ desde: new Date(0), hasta: new Date(), apiKey: 'k', tipo: 'call-control',
    fetch: async () => ({ ok: true, json: async () => ({ data: [{
      direction: 'inbound', cli: '+34600000001', cld: '+34943000001',
      started_at: '2026-08-01T10:00:00Z', call_sec: 0, connected: false,
    }], meta: { total_pages: 1 } }) }) });
  assert.equal(cruzar(r, []).perdidas[0].causa, 'no_contestada');
});

test('la ventana se acota por started_at, NO por date_range', async () => {
  // `filter[date_range][gte]/[lte]` devuelve HTTP 200 con CERO filas: un filtro
  // mal puesto que no da error. Se leía como «no hubo llamadas» y solo lo delató
  // el contador de «nuestras que Telnyx no ve». Comprobado en producción.
  const { traerDeTelnyx } = require('../src/lifecycle/conciliacion-telnyx');
  let urlPedida = '';
  await traerDeTelnyx({ desde: new Date('2026-07-18T00:00:00Z'), hasta: new Date('2026-08-01T00:00:00Z'),
    apiKey: 'k', tipo: 'call-control',
    fetch: async (u) => { urlPedida = decodeURIComponent(u); return { ok: true, json: async () => ({ data: [], meta: { total_pages: 1 } }) }; } });
  assert.match(urlPedida, /filter\[started_at\]\[gte\]=2026-07-18/);
  assert.match(urlPedida, /filter\[started_at\]\[lte\]=2026-08-01/);
  assert.doesNotMatch(urlPedida, /date_range/, 'ha vuelto el filtro que devuelve cero en silencio');
  assert.match(urlPedida, /record_type\]=call-control/);
});
