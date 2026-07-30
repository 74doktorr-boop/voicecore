'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL CUPO DEL PLAN VIVE EN DOS SITIOS
//
// `src/billing/stripe.js` decide lo que se COBRA y `src/auth/middleware.js` lo
// que se LIMITA. Son dos ficheros distintos con el mismo número escrito a mano.
// El día que alguien cambie uno y no el otro, el cliente verá una cifra en la
// factura y otra en el portal — y nadie se enterará hasta que se queje.
//
// Y se vigila la trampa de segundo orden: el tope de seguridad es
// `incluidos × hardCapMultiplier`. Al bajar el cupo de 500 a 200, mantener el
// multiplicador en 3 habría dejado el corte duro en 600 minutos, y una clínica
// con volumen se quedaría sin que le cojan el teléfono a final de mes. El cupo
// es comercial; el tope es una red contra fugas de coste. No se mueven juntos.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function cupoDeStripe() {
  const s = leer('src/billing/stripe.js');
  const m = s.match(/minutes:\s*(\d+),\s*assistants:\s*999,\s*overagePerMinute/);
  assert.ok(m, 'no se encuentra el cupo del plan en stripe.js');
  return Number(m[1]);
}
function limitesDelMiddleware() {
  const s = leer('src/auth/middleware.js');
  const m = s.match(/negocio:\s*\{\s*minutesPerMonth:\s*(\d+)[^}]*hardCapMultiplier:\s*(\d+)/);
  assert.ok(m, 'no se encuentran los límites del plan negocio en middleware.js');
  return { incluidos: Number(m[1]), multiplicador: Number(m[2]) };
}

test('lo que se cobra y lo que se limita dicen el MISMO número', () => {
  const cobro = cupoDeStripe();
  const { incluidos } = limitesDelMiddleware();
  assert.equal(cobro, incluidos,
    `stripe.js dice ${cobro} minutos incluidos y middleware.js dice ${incluidos}. ` +
    'Uno cobra y el otro limita: si se separan, el cliente ve una cosa y paga otra.');
});

test('el tope de seguridad deja trabajar a un cliente con volumen real', () => {
  const { incluidos, multiplicador } = limitesDelMiddleware();
  const tope = incluidos * multiplicador;
  // El perfil al que vamos son 100-400 llamadas al mes. Con la duración media
  // medida en producción (1,16 min), 400 llamadas son ~464 minutos. El tope
  // tiene que dejar holgura de verdad por encima de eso: si corta, el teléfono
  // deja de sonar y el producto no vale nada ese mes.
  const MINUTOS_CLIENTE_GRANDE = 464;
  assert.ok(tope >= MINUTOS_CLIENTE_GRANDE * 3,
    `El corte duro está en ${tope} min. Un cliente de 400 llamadas/mes gasta ` +
    `~${MINUTOS_CLIENTE_GRANDE}, así que se quedaría sin servicio a final de mes. ` +
    'Si bajas el cupo, sube hardCapMultiplier.');
});

test('el cupo no puede quedar por encima del punto de equilibrio', () => {
  const { incluidos } = limitesDelMiddleware();
  // Coste medido en producción sobre 52 llamadas reales: 0,0969 €/min.
  // Un plan de 49 € se paga a sí mismo hasta ~506 minutos. Regalar más que eso
  // es vender a pérdida a quien más te usa, que además es el que más te importa.
  const COSTE_MIN = 0.0969;
  const PRECIO = Number(process.env.PLAN_PRICE_EUR) || 49;
  const equilibrio = PRECIO / COSTE_MIN;
  assert.ok(incluidos < equilibrio,
    `El plan incluye ${incluidos} min y el equilibrio está en ${Math.round(equilibrio)}. ` +
    'Un cliente que agote su cupo no deja margen.');
  // Y con holgura, no al filo.
  assert.ok(incluidos <= equilibrio * 0.6,
    `${incluidos} min es demasiado cerca del equilibrio (${Math.round(equilibrio)}): ` +
    'sin colchón, cualquier subida de coste del proveedor lo pone en pérdida.');
});
