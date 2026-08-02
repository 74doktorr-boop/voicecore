'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LO PÚBLICO NO LLEVA NOMBRES
//
// Los endpoints de salud son públicos a propósito: tienen que poder mirarse
// desde fuera, porque si el aviso dependiera del propio servicio no llegaría
// justo el día que hace falta.
//
// Pero público y descuidado no son lo mismo, y el 02/08 se comprobó midiendo lo
// que devolvían de verdad:
//
//   · /health/voz publicaba «Centro Osakin», «hierros a freixa», … — la cartera
//     de clientes entera, enumerable por cualquiera sin autenticar.
//   · /health/avisos publicaba dos direcciones de correo reales.
//
// Ninguno de los dos hacía falta para lo que el endpoint tiene que demostrar. Lo
// accionable de una alarma es el MOTIVO, no de quién es; la identidad solo se
// necesita al ir a arreglarlo, y para eso ya hay sesión.
//
// Este fichero existe para que la puerta no se vuelva a abrir por descuido: al
// añadir un campo al informe es facilísimo colar un nombre sin pensarlo.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ref, correo } = require('../src/monitoring/sin-identidades');

test('la referencia es estable, corta y no devuelve el original', () => {
  // Estable para poder cruzarla con el panel; si cambiara en cada pasada, el
  // aviso no serviría para nada.
  assert.equal(ref('org-abc'), ref('org-abc'));
  assert.notEqual(ref('org-abc'), ref('org-abd'));
  assert.match(ref('org-abc'), /^[0-9a-f]{6}$/);
  assert.ok(!ref('Centro Osakin').includes('Osakin'));
  assert.equal(ref(null), null);
  assert.equal(ref(''), null);
});

test('el correo enmascarado deja ver el dominio, y NADA más', () => {
  // El dominio se conserva a propósito: el fallo que motivó todo esto fue tener
  // DOS líneas NOTIFY_EMAIL distintas, y sin verlo «los avisos llegan» y «los
  // avisos llegan al buzón equivocado» volverían a parecerse.
  assert.equal(correo('74doktorr@gmail.com'), '7***@gmail.com');
  assert.equal(correo('unai@nodeflow.es'), 'u***@nodeflow.es');
  assert.equal(correo('sin-arroba'), null);
  assert.equal(correo('@empieza-por-arroba'), null);
  assert.equal(correo(null), null);
});

test('el informe PÚBLICO de la voz no lleva ningún nombre de organización', async () => {
  const mod = require('../src/monitoring/prueba-de-voz');
  const store = require('../src/utils/rate-store');
  const lleno = {
    cuando: '2026-08-02T10:00:00Z', revisadas: 2, conProblemas: 1,
    problemas: [{ org: 'Centro Osakin', orgId: 'o-1', voz: 'greg-en', motivo: 'la voz habla "en"' }],
    avisos: [{ org: 'hierros a freixa', orgId: 'o-2', aviso: 'sin voz configurada' }],
    detalle: [
      { org: 'Centro Osakin', orgId: 'o-1', voz: 'greg-en', ok: false, bytes: 0, ms: 12 },
      { org: 'hierros a freixa', orgId: 'o-2', voz: 'marta-ca', ok: true, bytes: 900, ms: 1200 },
    ],
    resumen: '1 de 2 organizaciones NO suenan como deberían',
  };
  await store.put(mod.CLAVE, JSON.stringify(lleno), 60_000);
  const pub = await mod.informePublico();
  const texto = JSON.stringify(pub);

  for (const nombre of ['Centro Osakin', 'hierros a freixa', 'o-1', 'o-2']) {
    assert.ok(!texto.includes(nombre), `el informe público sigue publicando «${nombre}»`);
  }
  // Y lo que SÍ tiene que seguir estando, porque es lo accionable:
  assert.equal(pub.conProblemas, 1);
  assert.match(pub.problemas[0].motivo, /habla "en"/);
  assert.match(pub.problemas[0].ref, /^[0-9a-f]{6}$/);
  assert.equal(pub.detalle[1].bytes, 900);
  // La referencia del mismo cliente coincide entre secciones: se puede cruzar.
  assert.equal(pub.problemas[0].ref, pub.detalle[0].ref);
});

test('la ruta pública usa informePublico, y la de nombres pide sesión', () => {
  const rutas = fs.readFileSync(path.join(__dirname, '..', 'src/api/routes.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src/api/routes-admin.js'), 'utf8');

  // Es un cableado de una línea y por eso mismo es fácil de deshacer sin querer:
  // basta con que alguien "simplifique" informePublico() a informe().
  for (const ruta of ['/health/voz', '/health/avisos']) {
    const i = rutas.indexOf(`app.get('${ruta}'`);
    assert.ok(i > 0, `no se encuentra la ruta ${ruta}`);
    const bloque = rutas.slice(i, i + 600);
    assert.match(bloque, /informePublico\(\)/,
      `${ruta} volvió a publicar el informe COMPLETO: lleva nombres o direcciones`);
  }
  // Y las versiones con nombres, detrás del candado.
  for (const ruta of ['/api/admin/prueba-voz', '/api/admin/avisos']) {
    const i = admin.indexOf(`app.get('${ruta}'`);
    assert.ok(i > 0, `no se encuentra ${ruta}`);
    assert.match(admin.slice(i, i + 120), /adminAuth/, `${ruta} está SIN autenticar`);
  }
});
