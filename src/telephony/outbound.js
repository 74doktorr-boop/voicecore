// ============================================================
// NodeFlow — Motor de llamadas salientes (compartido)
// ------------------------------------------------------------
// Lo usan: el portal ("Llámame y pruébalo", "Que le llame") y el
// dispatcher de campañas. Una sola implementación de:
//   1. Resolución del número saliente (org → nf_phone_pool → env)
//   2. Inicio de llamada vía Telnyx TeXML (mismo flujo que entrante)
//   3. Registro de CONTEXTO: por qué llamamos — el asistente debe
//      saberlo. No se puede confiar en los <Parameter> del TeXML
//      (Telnyx no los entrega en el start), así que el contexto se
//      registra aquí por número destino y el WS handler lo consume.
// ============================================================
'use strict';

const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('OUTBOUND');

// ── Registro de salientes pendientes: callee normalizado → contexto ──
const _pending = new Map(); // numKey → { businessId, purpose, ref, promptBlock, expiresAt }
const PENDING_TTL_MS = 5 * 60 * 1000;

function _numKey(n) { return String(n || '').replace(/\D/g, '').replace(/^0+/, ''); }

function _gc() {
  const now = Date.now();
  for (const [k, v] of _pending) if (v.expiresAt < now) _pending.delete(k);
}

/**
 * Registra el propósito de una saliente. El WS handler lo consumirá al
 * arrancar el stream (matching por número) e inyectará promptBlock.
 */
function registerOutboundContext(calleeNumber, { businessId, purpose, ref = null, promptBlock = '' }) {
  _gc();
  const key = _numKey(calleeNumber);
  if (!key) return;
  _pending.set(key, { businessId, purpose, ref, promptBlock, expiresAt: Date.now() + PENDING_TTL_MS });
}

/**
 * Consume (una sola vez) el contexto de una saliente en curso.
 * Se llama con ambos números del stream (from/to) — uno será el callee.
 */
function consumeOutboundContext(...numbers) {
  _gc();
  for (const n of numbers) {
    const key = _numKey(n);
    if (key && _pending.has(key)) {
      const ctx = _pending.get(key);
      _pending.delete(key);
      return ctx;
    }
  }
  return null;
}

/**
 * Resuelve el número saliente de una org: config en memoria → pool → env.
 * nf_phone_pool es la fuente de verdad de asignaciones.
 */
async function resolveOutboundNumber(businessId, flowConfig = null) {
  let from = flowConfig?.automations?.config?.outboundNumber
    || process.env.TELNYX_PHONE_NUMBER || null;
  if (!from && businessId) {
    try {
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client.from('nf_phone_pool')
          .select('phone_number')
          .eq('org_id', businessId).eq('status', 'assigned')
          .limit(1).maybeSingle();
        if (data) from = data.phone_number;
      }
    } catch (e) { log.warn(`resolveOutboundNumber(${businessId}): ${e.message}`); }
  }
  return from;
}

/**
 * Normaliza un teléfono a E.164 — Telnyx lo EXIGE (error real 2026-07-03:
 * el dueño escribió "666351319" en el botón Llámame y Telnyx rechazó la
 * llamada). Nunca confiar en cómo teclee el número un humano:
 * "666 35 13 19", "0034...", "666351319" → "+34666351319".
 * Móviles/fijos españoles de 9 cifras (6/7/8/9) asumen +34.
 * @returns {string|null} E.164 o null si no es un teléfono plausible
 */
function normalizeE164(raw) {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^\+\d{7,15}$/.test(s)) return s;
  if (/^[6789]\d{8}$/.test(s)) return '+34' + s;      // nacional español
  if (/^34[6789]\d{8}$/.test(s)) return '+' + s;      // 34... sin el +
  return null;
}

/**
 * Inicia una llamada saliente Telnyx TeXML. Al descolgar, Telnyx pide el
 * TeXML a /voice/telnyx/:assistantId y conecta el asistente (mismo flujo
 * que una entrante). Si se pasa `context`, se registra para que el
 * asistente sepa por qué llama.
 *
 * @returns {Promise<{ok:true, callSid:string|null, provider:'telnyx'}>}
 * @throws  Error con mensaje accionable si falta config o Telnyx rechaza.
 */
async function startOutboundCall({ businessId, to, from = null, publicUrl = null, context = null }) {
  const apiKey = process.env.TELNYX_API_KEY;
  const appId  = process.env.TELNYX_APP_ID;
  if (!apiKey || !appId) {
    throw new Error(`Llamadas salientes no configuradas: falta ${!apiKey ? 'TELNYX_API_KEY' : 'TELNYX_APP_ID'} en el servidor.`);
  }

  const safeTo = normalizeE164(to);
  if (!safeTo) throw new Error('Número destino no válido');

  const fromNumber = from || await resolveOutboundNumber(businessId);
  if (!fromNumber) throw new Error('No hay número de teléfono saliente configurado para este negocio.');

  const base = publicUrl || process.env.PUBLIC_URL || 'https://nodeflow.es';

  if (context) registerOutboundContext(safeTo, { businessId, ...context });

  const resp = await fetch(`https://api.telnyx.com/v2/texml/calls/${encodeURIComponent(appId)}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      To:   safeTo,
      From: fromNumber,
      Url:  `${base}/voice/telnyx/${businessId}`,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = data.errors ? data.errors.map(e => e.detail || e.title).join('; ') : `HTTP ${resp.status}`;
    throw new Error(`Telnyx: ${detail}`);
  }

  log.info(`Saliente iniciada → ${safeTo} (org ${businessId}${context ? ', propósito: ' + context.purpose : ''})`);
  return { ok: true, callSid: (data.data && (data.data.call_sid || data.data.sid)) || null, provider: 'telnyx' };
}

// ── Bloques de propósito estándar (se añaden al systemPrompt) ─────────
const PURPOSE_BLOCKS = {
  test_call: (bizName) => `

## ESTA ES UNA LLAMADA SALIENTE DE PRUEBA
Estás llamando TÚ al dueño de ${bizName} para que te pruebe. Preséntate:
"¡Hola! Soy tu nueva asistente de ${bizName}. Esto es una llamada de prueba —
pregúntame lo que quieras: precios, horarios, o pídeme una cita de ejemplo."
Sé cercana y demuestra lo que sabes hacer. Si pide una cita de prueba, resérvala.`,

  recovery: (bizName, clientName) => `

## ESTA ES UNA LLAMADA SALIENTE DE RECUPERACIÓN
Estás llamando TÚ en nombre de ${bizName} a ${clientName || 'un cliente'} que
llamó hace poco y no llegó a reservar. Preséntate, di de dónde llamas, y
ofrécele amablemente encontrar un hueco. Si no le interesa o es mal momento,
despídete con amabilidad y NO insistas. Si no contesta un humano, cuelga.`,

  reactivation: (bizName, clientName, lastVisit) => `

## ESTA ES UNA LLAMADA SALIENTE DE REACTIVACIÓN
Estás llamando TÚ en nombre de ${bizName} a ${clientName || 'un cliente'}, que
vino por última vez${lastVisit ? ' el ' + lastVisit : ' hace un tiempo'} y hace
tiempo que no vuelve. Preséntate con calidez, di de dónde llamas y ofrécele
volver a reservar cuando le venga bien. Es una INVITACIÓN, no una venta: si no le
interesa o es mal momento, despídete con amabilidad y NO insistas. Nunca
presiones ni prometas nada que no puedas cumplir. Si no contesta un humano o
salta un buzón, cuelga sin dejar mensaje.`,
};

module.exports = { startOutboundCall, resolveOutboundNumber, registerOutboundContext, consumeOutboundContext, normalizeE164, PURPOSE_BLOCKS };
