// ============================================================
// NodeFlow — El email que prometía lo que aún no era verdad (2026-07-30)
//
// El email de activación decía "Tu asistente ya está configurado y listo" en el
// momento del alta. Pero la semilla de `assistant_config` (routes-billing)
// escribe nombre, voz y saludo — NUNCA el horario. Así que "listo" significaba:
// listo para reservar citas contra un calendario por defecto que el negocio no
// ha visto nunca.
//
// Y era el mejor sitio posible para pedirlo: el único momento en que el dueño
// está mirando el email con atención.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// El envío necesita Resend; lo que se comprueba aquí es el CONTENIDO, así que
// se separó el constructor puro del envío (mismo patrón que call-summary.js y
// buildSystemAudit). Sin eso este test tendría que parchear un require.
const { buildActivacionEmail } = require('../src/notifications/email');
const REGISTRO = { email: 'dueño@clinica.es', contacto: 'Marta Ruiz', negocio: 'Centro Osakin', plan: 'negocio' };

const htmlDeActivacion = async (opts) => buildActivacionEmail(REGISTRO, '+34843700832', opts);

describe('email de activación — sin horario configurado (el alta real)', () => {
  test('NO promete que está listo', async () => {
    const m = await htmlDeActivacion({ horarioConfigurado: false });
    assert.ok(m, 'no se envió nada');
    assert.ok(!/ya está configurado y listo/.test(m.html), 'no lo está: no tiene horario');
    assert.match(m.html, /ya tiene número/);
    assert.match(m.html, /Faltan dos cosas/);
  });

  test('pide el horario, y explica QUÉ se pierde sin él', async () => {
    const m = await htmlDeActivacion({ horarioConfigurado: false });
    assert.match(m.html, /Dinos a qué hora abres/);
    assert.match(m.html, /no puede confirmar horas/);
    assert.match(m.html, /Poner mi horario/);
  });

  test('el paso del horario va el PRIMERO y la numeración no se rompe', async () => {
    const m = await htmlDeActivacion({ horarioConfigurado: false });
    assert.match(m.html, /Pon tu horario en el panel/);
    // 4 pasos numerados 1..4, sin saltos ni repetidos
    for (const n of ['1', '2', '3', '4']) {
      assert.ok(m.html.includes(`>${n}</div>`), `falta el paso ${n}`);
    }
  });

  test('por defecto asume que NO está configurado: es la realidad del alta', async () => {
    const m = await htmlDeActivacion(undefined);
    assert.match(m.html, /Dinos a qué hora abres/);
  });
});

describe('el botón "Poner mi horario" tiene que aterrizar en algún sitio', () => {
  // Un CTA roto en el email del alta no da error: deja al dueño en el panel sin
  // saber qué hacer, y el paso se pierde sin que nadie se entere. Esto ata las
  // tres piezas —email, router del portal y DOM— para que renombrar cualquiera
  // de ellas rompa un test en vez de romper el alta de un cliente.
  const fs = require('fs');
  const path = require('path');
  const raiz = path.join(__dirname, '..', 'public', 'portal');
  const portalJs = fs.readFileSync(path.join(raiz, 'portal.js'), 'utf8');
  const portalHtml = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

  test('el email enlaza con ?go=horario, en HTML y en texto', async () => {
    const m = await htmlDeActivacion({ horarioConfigurado: false });
    assert.match(m.html, /\/portal\?go=horario/);
    assert.match(m.text, /\/portal\?go=horario/);
  });

  test('el portal reconoce ese parámetro', () => {
    assert.match(portalJs, /_go === 'horario'/);
  });

  test('y lo que busca para hacer clic EXISTE en el HTML', () => {
    assert.match(portalJs, /btn-subtab\[data-subtab="horario"\]/, 'el selector cambió');
    assert.ok(portalHtml.includes('data-subtab="horario"'), 'la subpestaña ya no se llama así');
    assert.ok(portalHtml.includes('id="sec-asistente"'), 'la sección Asistente cambió de id');
    assert.ok(portalHtml.includes('id="asis-horario"'), 'el panel del horario cambió de id');
    assert.ok(portalHtml.includes('id="asis-schedule-grid"'), 'la rejilla del horario cambió de id');
  });
});

describe('email de activación — con horario ya puesto', () => {
  test('vuelve al mensaje de siempre y no pide lo que ya hizo', async () => {
    const m = await htmlDeActivacion({ horarioConfigurado: true });
    assert.match(m.html, /ya está configurado y listo/);
    assert.ok(!/Dinos a qué hora abres/.test(m.html));
    assert.ok(!/Pon tu horario en el panel/.test(m.html));
  });

  test('quedan 3 pasos, numerados del 1 al 3', async () => {
    const m = await htmlDeActivacion({ horarioConfigurado: true });
    for (const n of ['1', '2', '3']) assert.ok(m.html.includes(`>${n}</div>`), `falta el paso ${n}`);
    assert.ok(!m.html.includes('>4</div>'), 'no debería haber un cuarto paso');
  });
});
