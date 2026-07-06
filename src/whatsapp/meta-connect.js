// ============================================================
// NodeFlow — Conexión de número propio por Meta Cloud API directo
// (Fase 2, self-service Embedded Signup — 2026-07-04)
//
// El negocio autoriza en el popup oficial de Meta (Embedded Signup);
// el frontend nos manda el `code` + phone_number_id + waba_id. Este
// módulo cierra el ciclo:
//   1. exchangeCodeForToken  → token de negocio (no expira)
//   2. registerNumber        → activa el número en la Cloud API
//   3. subscribeAppToWaba    → sus mensajes entrantes llegan a nuestro webhook
//   4. submitTemplates       → alta de TODAS las plantillas de WA_TEMPLATES en su WABA
//   5. saveWaCredentials     → guardado cifrado (apiBase=null = Meta directo)
//
// La Graph API es inyectable (`deps.graph`) → testeable con mocks sin la
// app de Meta real. Los valores app_id/app_secret llegan por env cuando
// Meta desbloquee el registro de desarrollador y Unai cree la app.
// ============================================================
'use strict';

const https = require('https');
const { Logger } = require('../utils/logger');
const { WA_TEMPLATES } = require('./templates');

const log = new Logger('META-CONNECT');
const GRAPH_HOST = 'graph.facebook.com';
const GRAPH_VER = 'v19.0';

/** Llamada a la Graph API. → { status, body }. Nunca lanza. */
function defaultGraph(method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: GRAPH_HOST,
      path: path.startsWith('/') ? path : `/${path}`,
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(data); } catch { /* respuesta no-JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: { error: { message: e.message } } }));
    if (payload) req.write(payload);
    req.end();
  });
}

function _err(res, fallback) {
  return (res && res.body && res.body.error && res.body.error.message) || fallback;
}

/** code del Embedded Signup → token de negocio (no expira). */
async function exchangeCodeForToken(code, deps = {}) {
  const graph = deps.graph || defaultGraph;
  const appId = deps.appId !== undefined ? deps.appId : process.env.WA_APP_ID;
  const appSecret = deps.appSecret !== undefined ? deps.appSecret : process.env.WA_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: 'App de Meta no configurada (WA_APP_ID / WA_APP_SECRET).' };
  if (!code) return { ok: false, error: 'Falta el código de autorización.' };

  const path = `/${GRAPH_VER}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
  const res = await graph('GET', path, {});
  if (res.status === 200 && res.body && res.body.access_token) {
    return { ok: true, token: res.body.access_token };
  }
  return { ok: false, error: _err(res, 'No se pudo intercambiar el código.') };
}

/** Registra el número en la Cloud API (necesario antes de enviar). */
async function registerNumber(token, phoneNumberId, deps = {}) {
  const graph = deps.graph || defaultGraph;
  const res = await graph('POST', `/${GRAPH_VER}/${phoneNumberId}/register`, {
    token,
    body: { messaging_product: 'whatsapp', pin: deps.pin || '000000' },
  });
  if (res.status === 200) return { ok: true };
  return { ok: false, error: _err(res, 'No se pudo registrar el número.') };
}

/** Suscribe NUESTRA app al WABA del cliente → sus entrantes a nuestro webhook. */
async function subscribeAppToWaba(token, wabaId, deps = {}) {
  const graph = deps.graph || defaultGraph;
  const res = await graph('POST', `/${GRAPH_VER}/${wabaId}/subscribed_apps`, { token });
  if (res.status === 200) return { ok: true };
  return { ok: false, error: _err(res, 'No se pudo suscribir la app al WABA.') };
}

/** Da de alta las 3 plantillas en el WABA del cliente. No lanza. */
async function submitTemplates(token, wabaId, deps = {}) {
  const graph = deps.graph || defaultGraph;
  let submitted = 0;
  for (const tpl of WA_TEMPLATES) {
    try {
      const res = await graph('POST', `/${GRAPH_VER}/${wabaId}/message_templates`, { token, body: tpl });
      if (res.status === 200) submitted++;
      else log.warn(`Plantilla ${tpl.name} no entró: ${_err(res, 'error')}`);
    } catch (e) {
      log.warn(`Plantilla ${tpl.name} falló: ${e.message}`);
    }
  }
  return { ok: true, submitted };
}

/**
 * Orquesta la conexión completa de un número propio y guarda credenciales.
 * @param {string} businessId
 * @param {{code, phoneNumberId, wabaId, phoneNumber, displayName?}} params
 * @returns {Promise<{ok, phoneNumber?, templatesSubmitted?, error?}>}
 */
async function connectMetaNumber(businessId, params = {}, deps = {}) {
  const { code, phoneNumberId, wabaId, phoneNumber, displayName } = params;
  if (!businessId || !code || !phoneNumberId || !wabaId || !phoneNumber) {
    return { ok: false, error: 'Faltan datos de la conexión (code, phoneNumberId, wabaId, phoneNumber).' };
  }
  const saveWaCredentials = deps.saveWaCredentials || require('./accounts').saveWaCredentials;

  const exch = await exchangeCodeForToken(code, deps);
  if (!exch.ok) return { ok: false, error: exch.error };
  const token = exch.token;

  // register y subscribe: fallos se loguean pero no abortan el guardado —
  // el número puede quedar utilizable y reintentarse; sin credenciales
  // guardadas no habría número propio en absoluto.
  const reg = await registerNumber(token, phoneNumberId, deps);
  if (!reg.ok) log.warn(`[${businessId}] register: ${reg.error}`);
  const sub = await subscribeAppToWaba(token, wabaId, deps);
  if (!sub.ok) log.warn(`[${businessId}] subscribe: ${sub.error}`);

  const tpl = await submitTemplates(token, wabaId, deps);

  await saveWaCredentials(businessId, {
    phoneNumberId,
    accessToken: token,
    phoneNumber,
    wabaId,
    displayName: displayName || null,
    apiBase: null, // Meta Cloud API directo
  });
  log.info(`[${businessId}] Número propio conectado: ${phoneNumber} (${tpl.submitted}/3 plantillas)`);

  return { ok: true, phoneNumber, templatesSubmitted: tpl.submitted };
}

module.exports = {
  exchangeCodeForToken, registerNumber, subscribeAppToWaba, submitTemplates, connectMetaNumber,
};
