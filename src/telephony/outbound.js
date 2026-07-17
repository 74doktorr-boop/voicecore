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
// Doble escritura (auditoría 2026-07-16): Map en memoria (rápido, misma réplica)
// + rateStore/Redis (para cuando el WEBHOOK DE RETORNO de la saliente cae en OTRA
// réplica que no la originó → antes se atendía SIN su prompt/propósito). Con una
// sola réplica funciona igual que antes (memoria); Redis solo aporta al escalar.
const _pending = new Map(); // numKey → { businessId, purpose, ref, promptBlock, expiresAt }
const PENDING_TTL_MS = 5 * 60 * 1000;
const _rateStore = require('../utils/rate-store');
const _ctxKey = (k) => `outctx:${k}`;

function _numKey(n) { return String(n || '').replace(/\D/g, '').replace(/^0+/, ''); }

function _gc() {
  const now = Date.now();
  for (const [k, v] of _pending) if (v.expiresAt < now) _pending.delete(k);
}

/**
 * Registra el propósito de una saliente. El WS handler lo consumirá al
 * arrancar el stream (matching por número) e inyectará promptBlock.
 */
async function registerOutboundContext(calleeNumber, { businessId, purpose, ref = null, promptBlock = '' }) {
  _gc();
  const key = _numKey(calleeNumber);
  if (!key) return;
  const ctx = { businessId, purpose, ref, promptBlock, expiresAt: Date.now() + PENDING_TTL_MS };
  _pending.set(key, ctx);
  try { await _rateStore.put(_ctxKey(key), JSON.stringify(ctx), PENDING_TTL_MS); } catch (_) {}
}

/**
 * Consume (una sola vez) el contexto de una saliente en curso.
 * Se llama con ambos números del stream (from/to) — uno será el callee.
 * Mira primero la memoria (misma réplica) y luego Redis (cruce de réplicas).
 */
async function consumeOutboundContext(...numbers) {
  _gc();
  for (const n of numbers) {
    const key = _numKey(n);
    if (!key) continue;
    if (_pending.has(key)) {
      const ctx = _pending.get(key);
      _pending.delete(key);
      try { await _rateStore.del(_ctxKey(key)); } catch (_) {} // limpia la copia compartida
      return ctx;
    }
    // No estaba en esta réplica: ¿la originó otra? (get+del atómico)
    try {
      const raw = await _rateStore.take(_ctxKey(key));
      if (raw) return JSON.parse(raw);
    } catch (_) {}
  }
  return null;
}

/**
 * Resuelve el número saliente de una org: config en memoria → POOL → env.
 * nf_phone_pool es la fuente de verdad de asignaciones.
 *
 * ORDEN CORREGIDO (bug real 2026-07-15, prueba de Osakin): el env global
 * TELNYX_PHONE_NUMBER ganaba al número PROPIO de la org en el pool — si la
 * config en memoria estaba estancada, la org llamaba desde el número de OTRO
 * negocio (el global). Lo específico de la org gana SIEMPRE al global.
 */
async function resolveOutboundNumber(businessId, flowConfig = null) {
  let from = flowConfig?.automations?.config?.outboundNumber || null;
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
  return from || process.env.TELNYX_PHONE_NUMBER || null;
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

  if (context) await registerOutboundContext(safeTo, { businessId, ...context });

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

  // Demo pública "Llámame" de la landing: un POSIBLE CLIENTE (dueño de un
  // negocio) pidió que la IA le llame para probarla. Ataca la objeción nº1 de
  // la simulación de embudo 2026-07-17 (74% no compra por no fiarse de la IA):
  // oírla en SU teléfono vale más que cualquier anuncio.
  llamame_demo: (bizName, prospectName, prospectSector) => `

## ESTA ES UNA LLAMADA DE DEMOSTRACIÓN A UN POSIBLE CLIENTE
Estás llamando a ${prospectName || 'una persona'} que tiene un negocio${prospectSector ? ' de ' + prospectSector : ''} y ha pedido en la web de NodeFlow que le llames para PROBARTE. No es un cliente final: es el DUEÑO de un negocio valorando si contratarte como recepcionista.
Preséntate: "¡Hola${prospectName ? ' ' + prospectName : ''}! Soy la asistente de NodeFlow. Me has pedido que te llame para probarme — imagina que soy la recepcionista de tu negocio: pregúntame lo que quieras, o pídeme una cita de ejemplo y verás cómo la gestiono."
Demuestra con naturalidad lo que sabes hacer (contestar dudas, proponer huecos, confirmar una cita de ejemplo). Si pregunta cómo contratar, dile que en nodeflow.es o que el equipo le escribirá. Sé cercana, breve por turno, y NUNCA presiones. Si salta un buzón de voz, cuelga sin dejar mensaje.`,

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
