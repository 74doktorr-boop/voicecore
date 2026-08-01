'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL ASISTENTE APRENDE, Y NADIE LO VEÍA
//
// El bucle de mejora lleva desde julio detectando patrones en llamadas reales y
// guardándolos como reglas candidatas. Estaba TODO montado: la tabla, la
// pestaña Mejora del admin, el botón de aprobar, y la inyección de las activas
// en el prompt (voice-pipeline.js). Y el 01/08 la foto era esta:
//
//     21 reglas · 17 en «candidate» · 4 rechazadas · 0 ACTIVAS
//
// Diecisiete esperando desde hacía semanas. Y no por malas:
//   · «Evitar repetir preguntas ya respondidas»            (visto 4 veces)
//   · «Dar el precio del cobre si está disponible»         (visto 5 veces,
//      aprendido solo de las llamadas reales de un cerrajero)
//   · «Confirmar el motivo de la consulta antes de la cita» (fisioterapia)
//
// Faltaba lo de siempre en este repo: nada AVISABA de que estaban ahí. Una
// herramienta que hay que acordarse de abrir es una herramienta que no se abre.
// Y esto es lo único del producto que mejora solo con el uso — el activo que un
// competidor que arranque mañana no tiene. Dejarlo parado es tirarlo.
//
// Dos sitios, dos públicos:
//   · el ADMIN, para que Unai las apruebe (cabina «Necesita tu atención»);
//   · el PORTAL, para que el dueño vea lo que su asistente ha aprendido de sus
//     llamadas — que es el único argumento contra «no me fío de la IA» que no
//     se discute, se enseña.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

test('la cabina del admin pide las reglas candidatas', () => {
  const admin = leer('public/admin/index.html');
  assert.match(admin, /learned-rules\?status=candidate/,
    'la cabina no consulta las reglas pendientes');
  assert.match(admin, /ha aprendido[^\n]*visto bueno/,
    'la cabina no anuncia las reglas pendientes');
});

test('destaca las que YA SE REPITEN, que son las que valen', () => {
  // Una regla vista una vez puede ser una casualidad de esa llamada. Vista
  // cuatro, es un patrón — y ordenar por eso es la diferencia entre una lista
  // que se revisa y una lista que se pospone.
  const admin = leer('public/admin/index.html');
  assert.match(admin, /r\.recurrent \|\| \(r\.count \|\| 0\) >= 3/,
    'no se distingue una regla recurrente de una anecdótica');
});

test('la cabina enseña el TEXTO de la regla, no solo el número', () => {
  // «17 reglas pendientes» no mueve a nadie. «Evitar repetir preguntas ya
  // respondidas» sí: se entiende el valor sin abrir nada.
  const admin = leer('public/admin/index.html');
  assert.match(admin, /cands\.slice\(0, 2\)[\s\S]{0,120}r\.text/,
    'no se muestra ningún ejemplo del contenido de las reglas');
});

test('el portal expone lo aprendido al DUEÑO', () => {
  const rp = leer('src/api/routes-portal.js');
  assert.match(rp, /\/api\/portal\/aprendido/, 'falta la ruta para el dueño');
  assert.match(rp, /portalAuth/, 'la ruta del dueño tiene que ir autenticada');
});

test('al dueño solo se le enseñan las reglas ACTIVAS', () => {
  // Las candidatas son cocina interna. Enseñar una regla que todavía no se
  // aplica sería prometer un comportamiento que no ocurre — exactamente el
  // error que este repo lleva dos días quitando de la web.
  const rp = leer('src/api/routes-portal.js');
  const bloque = rp.slice(rp.indexOf("/api/portal/aprendido"), rp.indexOf("/api/portal/knowledge"));
  assert.match(bloque, /status: 'active'/, 'se estarían enseñando reglas sin aprobar');
  assert.doesNotMatch(bloque, /candidate/, 'no se pueden enseñar candidatas al cliente');
});

test('solo las de SU sector o globales, no las de otros negocios', () => {
  const rp = leer('src/api/routes-portal.js');
  const bloque = rp.slice(rp.indexOf("/api/portal/aprendido"), rp.indexOf("/api/portal/knowledge"));
  assert.match(bloque, /r\.sector === 'global' \|\| r\.sector === sector/,
    'un negocio vería las reglas aprendidas del sector de otro');
});

test('cada regla dice de dónde salió', () => {
  // Sin el origen parece que se lo inventa alguien en una oficina, que es justo
  // lo contrario de lo que se quiere transmitir: que salió de SUS llamadas.
  const rp = leer('src/api/routes-portal.js');
  const bloque = rp.slice(rp.indexOf("/api/portal/aprendido"), rp.indexOf("/api/portal/knowledge"));
  assert.match(bloque, /origen:/);
  assert.match(bloque, /vecesVisto:/);
});

test('si falla la consulta, el portal NO se rompe', () => {
  // Esto es un adorno de confianza, no una función crítica. Que tumbe el panel
  // del cliente por un fallo de la tabla sería absurdo.
  const rp = leer('src/api/routes-portal.js');
  const bloque = rp.slice(rp.indexOf("/api/portal/aprendido"), rp.indexOf("/api/portal/knowledge"));
  assert.match(bloque, /catch[\s\S]{0,120}aprendido: \[\]/, 'la ruta debería fallar hacia vacío');
});
