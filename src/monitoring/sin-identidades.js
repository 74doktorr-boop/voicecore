// ============================================================================
// NodeFlow — LO PÚBLICO NO LLEVA NOMBRES
// ----------------------------------------------------------------------------
// Los endpoints de salud son públicos a propósito: tienen que poder mirarse
// DESDE FUERA, porque si el aviso dependiera del propio servicio no llegaría
// justo el día que hace falta. Ese es todo su sentido.
//
// Pero público y descuidado no son lo mismo, y el 02/08 se comprobó midiendo:
//
//   · /health/voz publicaba «Centro Osakin», «hierros a freixa»… — o sea, la
//     cartera de clientes entera, enumerable por cualquiera sin autenticar.
//   · /health/avisos publicaba dos direcciones de correo reales.
//
// Ninguno de los dos datos hacía falta para lo que el endpoint tiene que probar.
// Lo accionable de una alarma es EL MOTIVO —«la voz habla en inglés», «el correo
// rebota»—, no de quién es. La identidad solo se necesita al ir a arreglarlo, y
// para eso ya hay sesión.
//
// Así que fuera van referencias opacas y motivos; los nombres quedan detrás de
// adminAuth. La referencia es estable (mismo id → misma ref), así que el aviso
// sigue sirviendo para correlacionar sin publicar nada.
// ============================================================================
'use strict';

const crypto = require('crypto');

/**
 * Referencia corta, estable y no reversible de un identificador.
 * Estable para poder cruzarla con el panel; corta para que quepa en un correo.
 */
function ref(id) {
  if (!id) return null;
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 6);
}

/**
 * Correo enmascarado: deja ver el dominio y la primera letra.
 *
 * Se conserva algo a propósito. El fallo que motivó todo esto fue tener DOS
 * líneas NOTIFY_EMAIL con direcciones distintas: con la dirección totalmente
 * borrada, «los avisos llegan» y «los avisos llegan al buzón equivocado» se
 * verían igual, que es el error que se quería poder ver. Con el dominio y la
 * inicial basta para notar que va a otro sitio, y no basta para escribir a nadie.
 */
function correo(dir) {
  const s = String(dir || '');
  const i = s.indexOf('@');
  if (i < 1) return null;
  return `${s[0]}***${s.slice(i)}`;
}

module.exports = { ref, correo };
