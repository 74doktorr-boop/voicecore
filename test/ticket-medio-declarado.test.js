'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL PANEL NO PUEDE ENSEÑAR UN EURO QUE EL DUEÑO NO HAYA DECLARADO
//
// El precio medio por servicio es el número que convierte «12 llamadas
// atendidas» en «X € recuperados» — la única cifra que le importa a quien paga.
// Y el 01/08 estaba así:
//
//   · El ALTA no lo preguntaba. En ningún paso. Tres de las cuatro
//     organizaciones de producción no lo tenían.
//   · Y el formulario del portal era PEOR que no preguntarlo: rellenaba el
//     campo con 35 y, al guardar cualquier otra cosa de esa pantalla, escribía
//     ese 35 como `avgTicket`. Para `value-model.js` eso es `source:
//     'configured'` — «lo que el dueño declaró. Manda siempre». O sea que la
//     interfaz FABRICABA la declaración y colaba un número inventado por la
//     puerta de máxima confianza.
//
// Un taller cuyo ticket real son 180 € veía su valor dividido por cinco. Y ese
// es el caso que quema: el dueño hace la cuenta, no le cuadra, y deja de
// creerse TODAS las demás cifras — incluidas las que sí son honestas.
//
// Estos tests vigilan la regla: lo que acabe en la base es SIEMPRE algo que
// alguien ha tecleado, y si no hay nada, el panel dice que no lo sabe.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const { resolveAvgTicket } = require('../src/analytics/value-model');

test('sin ticket declarado, el modelo dice que NO LO SABE (no un 35)', () => {
  for (const entrada of [{}, { configured: null }, { configured: 0 }, { configured: '' }]) {
    const r = resolveAvgTicket(entrada);
    assert.equal(r.value, null, `ha inventado un ticket para ${JSON.stringify(entrada)}`);
    assert.equal(r.source, null);
  }
});

test('lo declarado manda; si no, la MEDIANA de precios reales', () => {
  assert.deepEqual(resolveAvgTicket({ configured: 180 }), { value: 180, source: 'configured', n: 0 });
  // Mediana y no media: cuatro limpiezas de 40 € y un implante de 1.200 € no
  // pueden inflar el «ticket típico» de una clínica.
  const obs = resolveAvgTicket({ prices: [40, 40, 45, 38, 1200] });
  assert.equal(obs.source, 'observed');
  assert.ok(obs.value < 100, `la mediana salió ${obs.value}: se está colando el caso caro`);
});

test('el formulario del portal ya NO rellena el campo con 35', () => {
  // Era una línea de nada y era la que fabricaba la declaración.
  const portal = leer('public/portal/portal.js');
  assert.doesNotMatch(portal, /cfgAvgTicket[^\n]*\|\|\s*35/,
    'el campo del ticket vuelve a prerrellenarse con 35');
  assert.match(portal, /cfgAvgTicket[^\n]*placeholder=/,
    'el campo debería llevar marcador de posición, no valor');
});

test('guardar con el campo vacío NO escribe un 35', () => {
  const portal = leer('public/portal/portal.js');
  assert.doesNotMatch(portal, /avgTicket:\s*parseFloat\([^)]*\)\s*\|\|\s*35/,
    'al guardar vuelve a inventarse un 35: eso entra como «declarado por el dueño»');
  assert.match(portal, /avgTicket:[\s\S]{0,240}?:\s*null/,
    'vacío tiene que guardarse como null');
});

test('el ALTA pregunta el precio medio', () => {
  const alta = leer('public/onboarding.html');
  assert.match(alta, /id="ticketMedio"/, 'el alta no pregunta el precio medio');
  assert.match(alta, /ticketMedio:/, 'el alta no manda el precio medio al servidor');
});

test('la sugerencia por sector es MARCADOR, nunca valor', () => {
  // Es la trampa exacta del 35: una sugerencia que rellena se convierte en una
  // declaración que nadie ha hecho. Tiene que ir en `placeholder`.
  const alta = leer('public/onboarding.html');
  assert.match(alta, /inp\.placeholder\s*=/, 'la sugerencia debería ir al placeholder');
  assert.doesNotMatch(alta, /ticketMedio'\)\.value\s*=\s*(String\()?s\b/,
    'la sugerencia está RELLENANDO el campo en vez de solo sugerirlo');
});

test('las sugerencias cubren sectores de escalas muy distintas', () => {
  // Un único número por defecto no puede servir a un taller y a una peluquería:
  // se llevan un factor 6. Que existan las dos puntas es lo que demuestra que
  // la lista es por sector de verdad y no un 35 con otro nombre.
  const alta = leer('public/onboarding.html');
  const m = alta.match(/const TICKET_SUGERIDO = \{([\s\S]*?)\};/);
  assert.ok(m, 'no se encuentra la tabla de sugerencias');
  const vals = [...m[1].matchAll(/:\s*(\d+)/g)].map(x => Number(x[1]));
  assert.ok(vals.length >= 20, `solo ${vals.length} sectores con sugerencia`);
  assert.ok(Math.min(...vals) <= 30, 'falta algún sector de ticket bajo (barbería, bar)');
  assert.ok(Math.max(...vals) >= 500, 'falta algún sector de ticket alto (reformas, autoescuela)');
  assert.ok(!vals.includes(35) || vals.filter(v => v === 35).length <= 2,
    'demasiados sectores con 35: eso es el número genérico volviendo por la puerta de atrás');
});

test('el alta siembra el ticket en la org al activarse', () => {
  const billing = leer('src/api/routes-billing.js');
  assert.match(billing, /ticket_medio/, 'el ticket del alta no se siembra en la organización');
  assert.match(billing, /semilla\.avgTicket/, 'no se guarda como avgTicket, que es lo que lee el modelo');
});

test('el servidor solo guarda el ticket si es un número positivo', () => {
  const reg = leer('src/api/routes-registro.js');
  assert.match(reg, /Number\(ticketMedio\)\s*>\s*0/,
    'el servidor debería ignorar un ticket vacío o absurdo en vez de guardarlo');
});
