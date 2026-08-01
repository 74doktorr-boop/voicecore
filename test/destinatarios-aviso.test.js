'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LOS AVISOS DE PRODUCCIÓN TIENEN QUE PODER IR A MÁS DE UN SITIO
//
// En la configuración de producción había NUEVE variables duplicadas, y una de
// ellas era `NOTIFY_EMAIL` con DOS DIRECCIONES DISTINTAS. Comprobado contra
// producción —preguntándole a la propia aplicación qué había resuelto— manda la
// ÚLTIMA. O sea que una de las dos llevaba meses sin recibir un solo aviso.
//
// Y esa es la avería peligrosa: nadie se entera de que no le llegan avisos. Un
// buzón callado se parece muchísimo a que todo va bien. Sólo se descubre el día
// que hace falta, que es el día que algo se ha roto.
//
// Al quitar el duplicado había que elegir una de las dos, y elegir mal deja los
// avisos cayendo en un buzón que nadie mira. Así que en vez de elegir, se
// aceptan varias separadas por coma.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { destinatarios } = require('../src/notifications/email');

test('una sola dirección sigue funcionando igual', () => {
  assert.deepEqual(destinatarios('unai@nodeflow.es'), ['unai@nodeflow.es']);
});

test('dos direcciones separadas por coma llegan a las dos', () => {
  assert.deepEqual(destinatarios('unai@nodeflow.es,hola@nodeflow.es'),
    ['unai@nodeflow.es', 'hola@nodeflow.es']);
});

test('se limpian los espacios que uno deja al escribirlas', () => {
  // Escrito a mano en el panel de EasyPanel, lo normal es poner un espacio
  // detrás de la coma. Sin recortarlo, Resend recibe " hola@…" y lo rechaza.
  assert.deepEqual(destinatarios(' unai@nodeflow.es ,  hola@nodeflow.es '),
    ['unai@nodeflow.es', 'hola@nodeflow.es']);
});

test('el punto y coma también vale (es lo que sale de copiar de un cliente de correo)', () => {
  assert.deepEqual(destinatarios('a@x.es; b@y.es'), ['a@x.es', 'b@y.es']);
});

test('una lista ya hecha se respeta, y también se parte si trae comas dentro', () => {
  assert.deepEqual(destinatarios(['a@x.es', 'b@y.es']), ['a@x.es', 'b@y.es']);
  assert.deepEqual(destinatarios(['a@x.es,b@y.es', 'c@z.es']), ['a@x.es', 'b@y.es', 'c@z.es']);
});

test('vacío, nulo o solo comas → lista vacía, no una dirección basura', () => {
  // Esto es lo que hace que el envío falle RUIDOSAMENTE en vez de mandar un
  // correo a la cadena "undefined" y dar el aviso por entregado.
  for (const malo of ['', '   ', ',,', ' , ; ', null, undefined, []]) {
    assert.deepEqual(destinatarios(malo), [], `no debería salir nada de ${JSON.stringify(malo)}`);
  }
});

test('no se cuela la cadena "undefined" cuando la variable no está puesta', () => {
  // El fallo clásico: `process.env.NOTIFY_EMAIL` ausente se convierte en la
  // CADENA 'undefined' al interpolarla, y se manda un correo a un destinatario
  // que no existe creyendo que se ha avisado.
  assert.deepEqual(destinatarios(undefined), []);
  assert.deepEqual(destinatarios([undefined, null]), []);
});
