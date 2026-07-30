'use strict';
// ============================================================
// NodeFlow — ¿Puede WhatsApp enviar algo, ahora mismo?
//
// POR QUÉ EXISTE (2026-07-30): al ir a dar de alta una plantilla, Meta contestó
// «API access blocked» (OAuthException, code 200). No era la plantilla: es la
// cuenta. Con eso bloqueado no sale NADA — confirmaciones de cita, recordatorios
// 24h antes, peticiones de reseña, reactivaciones.
//
// Y el sistema no lo notaba. Cada envío fallido escribe un `log.warn` y sigue.
// Es el mismo patrón que ya costó caro en otros sitios: un fallo caro que solo
// existe en un log que nadie lee. El negocio se entera cuando un cliente no se
// presenta a una cita de la que nunca recibió recordatorio.
//
// Se sonda UNA vez al día desde la auditoría nocturna. No va en /health: el
// vigilante externo lo llama cada 10 minutos y no hay que gastar cuota de Meta
// —ni añadir su latencia— en cada latido.
//
// La clasificación es PURA: entra lo que respondió Meta, sale qué hacer.
// ============================================================

/**
 * Traduce la respuesta de Meta a algo accionable. PURA.
 *
 * Los códigos importan porque piden cosas distintas:
 *   190 → el token caduca/se revoca: se renueva y ya está.
 *   200 / 10 / 803 → permisos o cuenta restringida: hay que entrar en Business
 *        Manager. Renovar el token no arregla nada.
 *   4 / 80007 → límite de peticiones: se pasa solo.
 *
 * @param {number} status  código HTTP (0 si no se pudo ni conectar)
 * @param {object} body    JSON devuelto por Graph
 * @returns {{estado:'ok'|'bloqueado'|'token'|'limite'|'error'|'sin_configurar', titulo:string, detalle:string}}
 */
function clasificarRespuestaMeta(status, body) {
  if (status === 200 && body && !body.error) {
    return { estado: 'ok', titulo: 'WhatsApp responde', detalle: '' };
  }

  const err = (body && body.error) || {};
  const code = Number(err.code);
  // Meta acaba sus mensajes en punto ("API access blocked.") y aquí se
  // concatenan con más frase: sin esto sale "blocked.. NO sale…".
  const msg = String(err.message || '').trim().replace(/\.+$/, '');

  if (!status) {
    return {
      estado: 'error',
      titulo: 'No se pudo comprobar WhatsApp',
      detalle: `no hubo respuesta de Meta${msg ? `: ${msg}` : ''}. Puede ser red nuestra; si se repite mañana, mirarlo.`,
    };
  }
  if (code === 190) {
    return {
      estado: 'token',
      titulo: 'El token de WhatsApp ya no vale',
      detalle: `${msg || 'token caducado o revocado'}. Mientras tanto NO sale ningún aviso: ni confirmaciones, ni recordatorios, ni reseñas. Se arregla generando un token nuevo en Meta y actualizando WA_ACCESS_TOKEN.`,
    };
  }
  if (code === 200 || code === 10 || code === 803) {
    return {
      estado: 'bloqueado',
      titulo: 'Meta tiene BLOQUEADO el acceso a WhatsApp',
      detalle: `${msg || 'API access blocked'}. NO sale ningún aviso: ni confirmaciones de cita, ni recordatorios 24h antes, ni peticiones de reseña. Un token nuevo NO lo arregla — hay que entrar en Business Manager y resolver la restricción de la cuenta.`,
    };
  }
  if (code === 4 || code === 80007 || code === 613) {
    return {
      estado: 'limite',
      titulo: 'WhatsApp al límite de peticiones',
      detalle: `${msg || 'rate limit'}. Suele pasarse solo; si sigue mañana, mirarlo.`,
    };
  }
  return {
    estado: 'error',
    titulo: 'WhatsApp devuelve error',
    detalle: `HTTP ${status}${code ? ` · code ${code}` : ''}${msg ? ` · ${msg}` : ''}`,
  };
}

/** Nivel para el informe. Un bloqueo o un token muerto son CRÍTICOS: el negocio
 *  cree que sus clientes reciben avisos y no los reciben. PURA. */
function nivelDe(estado) {
  if (estado === 'bloqueado' || estado === 'token') return 'critico';
  if (estado === 'limite' || estado === 'error') return 'aviso';
  return 'ok';
}

/**
 * Pregunta a Meta si el WABA sigue accesible. No lanza nunca.
 * @param {{token?:string, wabaId?:string, fetch?:Function}} opts
 */
async function sondearWhatsApp(opts = {}) {
  const token = opts.token || process.env.WA_ACCESS_TOKEN;
  const wabaId = opts.wabaId || process.env.WA_BUSINESS_ACCOUNT_ID;
  const _fetch = opts.fetch || globalThis.fetch;

  if (!token || !wabaId) {
    return { estado: 'sin_configurar', titulo: '', detalle: '' };
  }
  try {
    const res = await _fetch(`https://graph.facebook.com/v19.0/${wabaId}?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: opts.signal,
    });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    return clasificarRespuestaMeta(res.status, body);
  } catch (e) {
    return clasificarRespuestaMeta(0, { error: { message: e.message } });
  }
}

module.exports = { clasificarRespuestaMeta, nivelDe, sondearWhatsApp };
