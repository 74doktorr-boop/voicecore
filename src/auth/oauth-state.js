// ============================================================
// NodeFlow — `state` de OAuth de un solo uso (anti-secuestro de cuenta).
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo S1):
// Antes, el `state` del OAuth de Google/Outlook ERA el organization_id, y el
// callback lo escribía en BD tal cual. El org_id no es un secreto: aparece en
// el HTML de los micrositios y en los enlaces de baja de los emails. Bastaba
// con iniciar el flujo con la cuenta propia y cambiar `state=<uuid-víctima>`
// en la URL de autorización para que los tokens del atacante acabaran en la
// fila de la víctima → todas SUS citas empezaban a sincronizarse al calendario
// del atacante.
//
// Ahora el `state` es un nonce opaco de 256 bits que se emite autenticado y se
// consume UNA sola vez. El org_id se resuelve del registro, nunca de la query.
//
// NOTA multi-réplica: se apoya en rateStore, que usa Redis si REDIS_URL está
// definido y un Map en memoria si no. Sin Redis y con 2+ réplicas, un callback
// que aterrice en otra réplica no encontrará el nonce y el flujo fallará
// CERRADO (el usuario ve "reintenta"), que es el lado correcto en el que fallar.
// ============================================================
'use strict';

const crypto = require('crypto');
const rateStore = require('../utils/rate-store');

const PREFIX  = 'oauthstate:';
const TTL_MS  = 10 * 60 * 1000; // 10 min: de sobra para autorizar, corto para robar

/**
 * Emite un state de un solo uso ligado a una org.
 * @param {string} orgId  organización autenticada que inicia el flujo
 * @param {string} provider  'google' | 'outlook' (evita cruzar states entre proveedores)
 * @returns {Promise<string>} nonce opaco para poner en la URL de autorización
 */
async function issueOAuthState(orgId, provider) {
  if (!orgId) throw new Error('issueOAuthState: orgId requerido');
  const nonce = crypto.randomBytes(32).toString('hex');
  await rateStore.put(`${PREFIX}${provider}:${nonce}`, String(orgId), TTL_MS);
  return nonce;
}

/**
 * Consume el state y devuelve el orgId al que pertenece. Un state solo vale una vez.
 * @returns {Promise<string|null>} orgId, o null si el state es inválido/caducado/ya usado
 */
async function consumeOAuthState(nonce, provider) {
  if (!nonce || typeof nonce !== 'string' || nonce.length !== 64) return null;
  if (!/^[0-9a-f]+$/.test(nonce)) return null;
  const orgId = await rateStore.take(`${PREFIX}${provider}:${nonce}`);
  return orgId || null;
}

module.exports = { issueOAuthState, consumeOAuthState, OAUTH_STATE_TTL_MS: TTL_MS };
