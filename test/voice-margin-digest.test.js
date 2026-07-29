'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MARGEN DE LA VOZ EN EL BRIEFING
//
// Lo que se fija aquí no es "que salga un número": es que sea IMPOSIBLE que un
// cliente cueste más de lo que paga sin que nadie se entere hasta la factura
// del proveedor. El dato llevaba meses guardándose y nadie lo miraba.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceMarginItems } = require('../src/monitoring/founder-digest');

// Supabase falso: encadena como el cliente real y devuelve las filas dadas.
function dbCon(filas, error = null) {
  const q = {
    select: () => q, gte: () => q, not: () => q, order: () => q,
    limit: () => Promise.resolve({ data: filas, error }),
  };
  return { client: { from: () => q } };
}
const llamada = (orgId, mins, eur) => ({
  org_id: orgId, duration_ms: mins * 60000, cost: { total: eur },
  created_at: new Date().toISOString(),
});

test('sin llamadas no dice nada (el briefing calla si no hay noticia)', async () => {
  assert.deepEqual(await voiceMarginItems(dbCon([])), []);
});

test('siempre deja el número del mes delante, aunque todo vaya bien', async () => {
  const items = await voiceMarginItems(dbCon([llamada('org-a', 1, 0.1)]));
  const foto = items.find(i => i.sev === 'info');
  assert.ok(foto, 'falta la foto del mes');
  assert.match(foto.txt, /€\/min/);
  // El punto de equilibrio es la cifra que convierte el dato en decisión.
  assert.match(foto.sub, /equilibrio/);
});

test('un cliente que se acerca a costar lo que paga es CRÍTICO', async () => {
  // 45 € de coste contra una cuota de 49 € = 92%.
  const items = await voiceMarginItems(dbCon([llamada('org-caro', 450, 45)]));
  const av = items.find(i => i.sev === 'crit');
  assert.ok(av, 'un cliente al 92% de su cuota tiene que ser crítico');
  assert.match(av.txt, /9[0-9]%/);
  assert.match(av.sub, /te cuesta dinero/);
});

test('a mitad de camino avisa, pero no despierta a nadie', async () => {
  const items = await voiceMarginItems(dbCon([llamada('org-medio', 300, 30)]));
  assert.ok(items.some(i => i.sev === 'warn' && /6[0-9]%/.test(i.txt)));
  assert.ok(!items.some(i => i.sev === 'crit'), '61% no es una emergencia');
});

test('un cliente barato no genera ruido', async () => {
  const items = await voiceMarginItems(dbCon([llamada('org-sano', 15, 1.5)]));
  assert.equal(items.filter(i => i.sev !== 'info').length, 0);
});

test('si el minuto se encarece, lo dice: ha cambiado la mezcla de proveedores', async () => {
  // 0,20 €/min — el doble de lo medido con ElevenLabs.
  const items = await voiceMarginItems(dbCon([llamada('org-x', 5, 1.0)]));
  const av = items.find(i => /El minuto de voz cuesta/.test(i.txt));
  assert.ok(av, 'un coste por minuto disparado no puede pasar en silencio');
  assert.match(av.sub, /TTS/);
});

test('las llamadas sin audio real no ensucian la media', async () => {
  const items = await voiceMarginItems(dbCon([
    llamada('org-a', 10, 1.0),
    { org_id: 'org-a', duration_ms: 500, cost: { total: 5 }, created_at: new Date().toISOString() }, // colgada
    { org_id: 'org-a', duration_ms: 60000, cost: {}, created_at: new Date().toISOString() },          // sin coste
  ]));
  const foto = items.find(i => i.sev === 'info');
  // 1,0 € en 10 min = 0,10 €/min. Si colara la de medio segundo con 5 €, se dispararía.
  assert.match(foto.txt, /0\.1000 €\/min/);
});

test('el truncamiento no es silencioso', async () => {
  const muchas = Array.from({ length: 5000 }, () => llamada('org-a', 1, 0.05));
  const items = await voiceMarginItems(dbCon(muchas));
  assert.ok(items.some(i => /truncad/i.test(i.txt)),
    'unos totales calculados sobre una parte del mes tienen que decirlo');
});

test('un fallo de consulta se propaga para que el briefing lo capture', async () => {
  await assert.rejects(
    () => voiceMarginItems(dbCon(null, { message: 'boom' })),
    /boom/,
    'debe lanzar: quien llama ya hace fail-open y no puede tragarse el error en silencio');
});
