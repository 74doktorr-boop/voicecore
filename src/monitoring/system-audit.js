'use strict';
// ============================================================
// NodeFlow — Auditoría técnica nocturna. Solo lectura.
//
// POR QUÉ VIVE AQUÍ Y NO EN UN AGENTE (2026-07-29):
// La tentación era programar un agente que auditara el sistema cada noche. Pero
// un agente corre en un portátil que se apaga y pierde conexión, y sin las
// credenciales de producción no puede mirar ni la base de datos. Esta app ya
// corre 24/7 en el servidor, ya tiene las credenciales, ya tiene elección de
// líder para no duplicarse entre réplicas y ya sabe mandar correo. Auditar
// desde fuera lo que el sistema puede contarte desde dentro es hacerlo peor.
//
// SIEMPRE ENVÍA, aunque esté todo bien. Es deliberado: founder-digest no manda
// nada cuando no hay novedades, y eso hace que "todo en orden" y "el cron está
// muerto" se vean exactamente igual desde la bandeja de entrada. Un latido que
// solo suena cuando hay problemas no es un latido. Si una mañana no llega este
// correo, eso YA es la señal.
//
// El núcleo es PURO: recibe los datos ya leídos y devuelve las líneas del
// informe. Así se puede probar entero sin BD ni correo.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('AUDIT');

const OBJETIVO_MS = 700;        // charter: <700ms hasta contestar
const P95_ALERTA_MS = 2000;     // por encima, el cliente cree que se ha cortado
const ROTAS_ALERTA = 0.25;      // 1 de cada 4 llamadas rotas ya es un problema

function _pct(valores, p) {
  const xs = (valores || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const i = (p / 100) * (xs.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (i - lo));
}

/**
 * Construye el informe. PURO.
 *
 * @param {object} d
 *   d.llamadas  — filas de nf_calls con {status, turn_count, metrics}
 *   d.esquema   — [{ pieza, ok, critico, rompe }]
 *   d.entorno   — [{ nombre, ok, rompe }]
 *   d.version   — { sha, telnyxSignature, redis, uptimeSegundos }
 * @returns {{ severidad:'ok'|'aviso'|'critico', lineas:Array, resumen:string }}
 */
function buildSystemAudit(d = {}) {
  const lineas = [];
  let critico = 0, avisos = 0;

  const marca = (nivel, titulo, detalle) => {
    if (nivel === 'critico') critico++; else if (nivel === 'aviso') avisos++;
    lineas.push({ nivel, titulo, detalle });
  };

  // ── 1. Piezas del esquema que el código necesita ──────────────────────────
  for (const p of (d.esquema || [])) {
    if (p.ok) continue;
    marca(p.critico ? 'critico' : 'aviso', `Falta ${p.pieza}`, p.rompe || '');
  }

  // ── 2. Variables de entorno críticas ──────────────────────────────────────
  for (const v of (d.entorno || [])) {
    if (v.ok) continue;
    marca('critico', `Falta la variable ${v.nombre}`, v.rompe || '');
  }

  // ── 3. Lo que el cliente PERCIBE ──────────────────────────────────────────
  const llamadas = (d.llamadas || []);
  const conConversacion = llamadas.filter(c => (c.turn_count || 0) > 0);
  const primerAudio = [];
  let conCorte = 0;
  for (const c of conConversacion) {
    const m = c.metrics || {}, q = m.quality || {};
    if ((q.fragmentGaps ?? m.fragmentGaps ?? 0) > 0) conCorte++;
    for (const t of (Array.isArray(m.turns) ? m.turns : [])) {
      if (Number.isFinite(t.firstAudioMs)) primerAudio.push(t.firstAudioMs);
    }
  }
  const p50 = _pct(primerAudio, 50), p95 = _pct(primerAudio, 95);

  if (p95 != null && p95 >= P95_ALERTA_MS) {
    marca('aviso', `Va lento: p95 de ${p95} ms hasta contestar`,
      `mediana ${p50} ms · objetivo <${OBJETIVO_MS} ms · ${primerAudio.length} turnos medidos`);
  } else if (p50 != null) {
    lineas.push({ nivel: 'ok', titulo: `Latencia: p50 ${p50} ms · p95 ${p95} ms`, detalle: `${primerAudio.length} turnos` });
  }

  if (conConversacion.length) {
    const pctCorte = conCorte / conConversacion.length;
    if (pctCorte >= 0.2) {
      marca('aviso', `${Math.round(pctCorte * 100)}% de las llamadas se entrecortan`,
        `${conCorte} de ${conConversacion.length}`);
    } else {
      lineas.push({ nivel: 'ok', titulo: `Entrecortado: ${conCorte} de ${conConversacion.length} llamadas`, detalle: '' });
    }
  }

  // ── 4. Fallos NUESTROS, separados de "el cliente colgó" ───────────────────
  // Antes esto decía "18% de llamadas rotas" y era falso: 8 de las 10 eran
  // pruebas de madrugada con asistentes de broma, y las otras 2 eran gente que
  // oyó el saludo y colgó — el sistema funcionó. Una alarma que cría lobo se
  // acaba ignorando, y entonces no avisa el día que importa. Ver call-outcome.js.
  if (llamadas.length) {
    const { resumirSalud } = require('./call-outcome');
    const r = resumirSalud(llamadas, d.numeros || {});

    if (r.externas === 0) {
      marca('aviso', 'Ninguna llamada de clientes reales en la ventana',
        `${r.internas} de nuestro propio tráfico (pruebas/salientes). Puede ser normal, o el desvío está caído`);
    } else {
      if (r.tasaFallo >= ROTAS_ALERTA) {
        marca('critico', `${Math.round(r.tasaFallo * 100)}% de llamadas con fallo NUESTRO`,
          `${r.fallo_sistema + r.sin_audio} de ${r.externas} — la IA no habló o la llamada murió a media conversación`);
      } else if (r.fallo_sistema + r.sin_audio > 0) {
        marca('aviso', `${r.fallo_sistema + r.sin_audio} llamada(s) con fallo nuestro`,
          `de ${r.externas} de clientes reales · ${r.fallos.slice(0, 3).map(f => f.motivo).join(' · ')}`);
      } else {
        lineas.push({ nivel: 'ok', titulo: `Sin fallos del sistema en ${r.externas} llamadas de clientes`, detalle: r.internas ? `(${r.internas} internas excluidas)` : '' });
      }

      // Señal de PRODUCTO, no de sistema: cuánta gente cuelga al oír a la IA.
      // Se arregla con el saludo y la voz, no con código — por eso va aparte.
      if (r.colgo_en_saludo > 0) {
        const pct = Math.round(r.tasaCuelgueSaludo * 100);
        lineas.push({
          nivel: pct >= 40 ? 'aviso' : 'ok',
          titulo: `${pct}% cuelga al oír el saludo (${r.colgo_en_saludo} de ${r.externas})`,
          detalle: pct >= 40 ? 'el sistema funciona; es el saludo o la voz lo que espanta' : 'el sistema funcionó: descolgó y habló',
        });
      }
    }
  } else {
    marca('aviso', 'Ninguna llamada en la ventana', 'puede ser normal, o el desvío está caído');
  }

  // ── 5. Números asignados que NO reciben llamadas ──────────────────────────
  // El detector de silencio de client-health exige ≥3 llamadas previas para
  // avisar de que han parado. Un número que NUNCA recibió ninguna es invisible
  // para él — y es el caso peor: el cliente pagó, se le dio número, y no ha
  // desviado su línea. Se descubrió con Centro Osakin: número asignado, CERO
  // entrantes en 90 días, y nadie se había enterado.
  for (const n of (d.numerosMudos || [])) {
    marca('critico', `${n.negocio}: su número no recibe llamadas`,
      `${n.numero} lleva asignado y sin una sola entrante. O no han desviado su línea, o el desvío está roto — en ambos casos el cliente cree tener el servicio y no lo tiene.`);
  }

  // ── 6. Qué versión corre y con qué protecciones ───────────────────────────
  const v = d.version || {};
  if (v.telnyxSignature && v.telnyxSignature !== 'enforced') {
    marca('critico', 'Los webhooks de voz NO verifican firma',
      'cualquiera puede POSTear a /voice/telnyx y arrancar llamadas a tu costa (falta TELNYX_PUBLIC_KEY)');
  }
  if (v.sha) lineas.push({ nivel: 'ok', titulo: `Versión desplegada: ${v.sha}`, detalle: v.redis ? `redis ${v.redis}` : '' });

  const severidad = critico ? 'critico' : avisos ? 'aviso' : 'ok';
  const resumen = critico ? `${critico} problema(s) crítico(s)`
    : avisos ? `${avisos} aviso(s)`
    : 'todo en orden';
  return { severidad, lineas, resumen };
}

/** El informe en HTML. Puro. */
function renderSystemAudit({ severidad, lineas, resumen }, ventanaDias = 7) {
  const color = severidad === 'critico' ? '#f87171' : severidad === 'aviso' ? '#fbbf24' : '#4ade80';
  const icono = (n) => (n === 'critico' ? '✖' : n === 'aviso' ? '!' : '✓');
  const fila = (l) => `<div style="padding:7px 0;border-top:1px solid rgba(255,255,255,.06);">
      <span style="color:${l.nivel === 'critico' ? '#f87171' : l.nivel === 'aviso' ? '#fbbf24' : '#4ade80'};font-weight:700;">${icono(l.nivel)}</span>
      <span style="color:#e2e8f0;font-size:13px;"> ${l.titulo}</span>
      ${l.detalle ? `<div style="color:#94a3b8;font-size:12px;margin-left:16px;">${l.detalle}</div>` : ''}
    </div>`;
  return `<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;margin:0;">
<div style="max-width:560px;margin:24px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">
  <div style="background:#13131a;padding:18px 26px;border-bottom:1px solid rgba(255,255,255,.06);">
    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;">NodeFlow · Auditoría técnica</span>
    <div style="font-size:17px;font-weight:800;color:${color};margin-top:4px;">${resumen}</div>
    <div style="font-size:12px;color:#64748b;margin-top:2px;">últimos ${ventanaDias} días</div>
  </div>
  <div style="padding:16px 26px 22px;">${lineas.map(fila).join('')}</div>
  <div style="padding:0 26px 20px;color:#64748b;font-size:11px;line-height:1.5;">
    Este correo llega TODAS las mañanas, también cuando está todo bien.
    Si un día no llega, eso ya es la señal: el servicio o su cron no están vivos.
  </div>
</div></body></html>`;
}

// Piezas del esquema que el código necesita. Mismo criterio que
// scripts/check-schema.js: se comprueban leyendo, nunca declarando.
const PIEZAS = [
  ['nf_calls', 'id,ai_decisions', true,  'el upsert de cierre falla ENTERO: se pierde transcripción, outcome, métricas y minutos de TODAS las llamadas'],
  ['nf_appointments', 'id,location', true, '_toRow envía siempre location: TODOS los upserts de cita fallan'],
  ['nf_appointments', 'id,staff', false, 'la cita se guarda sin profesional: dos profesionales no comparten hueco y tras reiniciar la agenda colapsa a 1:1'],
  ['scheduled_reminders', 'id', true, 'sin motor de seguimientos ni recordatorios'],
  ['contacts', 'id', true, 'sin CRM'],
  ['nf_campaign_calls', 'id', false, 'el dispatcher no lanza ninguna saliente'],
];

const ENV_CRITICAS = [
  ['JWT_SECRET', 'las sesiones del portal no se pueden emitir'],
  ['ENCRYPTION_KEY', 'las credenciales de WhatsApp no se pueden descifrar'],
  ['STRIPE_OVERAGE_METER_EVENT', 'el excedente de minutos SE CUENTA Y NO SE COBRA'],
  ['STRIPE_MSG_METER_EVENT', 'el excedente de mensajes SE CUENTA Y NO SE COBRA'],
];

/** Ejecuta la auditoría y manda el correo. Nunca lanza. */
async function runSystemAudit(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const enviar = deps.sendEmail || require('../notifications/email').sendEmail;
  const dias = deps.dias || 7;
  try {
    if (!db.enabled) { log.warn('auditoría: sin BD, se omite'); return false; }

    const esquema = [];
    for (const [tabla, cols, critico, rompe] of PIEZAS) {
      const { error } = await db.client.from(tabla).select(cols).limit(1);
      esquema.push({ pieza: `${tabla}.${cols.split(',').pop()}`, ok: !error, critico, rompe });
    }

    const entorno = ENV_CRITICAS.map(([nombre, rompe]) => ({
      nombre, rompe, ok: !!(process.env[nombre] && String(process.env[nombre]).trim()),
    }));

    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const { data: llamadas } = await db.client.from('nf_calls')
      .select('id,status,turn_count,duration_ms,caller_number,transcript,metrics').gte('started_at', desde).limit(3000);

    // Nuestro propio tráfico no cuenta para juzgar la salud del producto: son
    // pruebas y salientes. Los números propios salen del pool; los de prueba,
    // de TEST_PHONE_NUMBERS (lista separada por comas) y OWNER_PHONE.
    let numeros = { propios: [], prueba: [] };
    try {
      const { data: pool } = await db.client.from('nf_phone_pool').select('phone_number').limit(500);
      numeros.propios = (pool || []).map(p => p.phone_number).filter(Boolean);
    } catch (_) {}
    numeros.prueba = [
      ...String(process.env.TEST_PHONE_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean),
      ...(process.env.OWNER_PHONE ? [process.env.OWNER_PHONE] : []),
    ];

    let version = {};
    try {
      const { resolveSha } = require('../api/routes');
      const { telnyxSignatureStatus } = require('../utils/telnyx-signature');
      version = {
        sha: resolveSha(null, process.env.GIT_SHA),
        telnyxSignature: telnyxSignatureStatus().enforced ? 'enforced' : 'UNVERIFIED',
        redis: require('../utils/rate-store').isRedisEnabled() ? 'conectado' : 'memoria',
      };
    } catch (_) {}

    // Números asignados que no reciben nada: el cliente cree tener el servicio
    // y no lo tiene. Ventana amplia a propósito (90 días): aquí no buscamos una
    // bajada de tráfico, sino la ausencia TOTAL de él.
    const numerosMudos = [];
    try {
      const { data: pool } = await db.client.from('nf_phone_pool')
        .select('phone_number,org_id,status').eq('status', 'assigned').limit(200);
      const asignados = pool || [];
      if (asignados.length) {
        const desde90 = new Date(Date.now() - 90 * 864e5).toISOString();
        const { data: ent } = await db.client.from('nf_calls')
          .select('called_number,direction').gte('started_at', desde90).limit(5000);
        const recibidas = new Set((ent || []).filter(c => c.direction !== 'outbound').map(c => c.called_number));
        const { data: orgs } = await db.client.from('organizations').select('id,name').limit(200);
        const nombre = Object.fromEntries((orgs || []).map(o => [o.id, o.name]));
        for (const p of asignados) {
          if (!recibidas.has(p.phone_number)) {
            numerosMudos.push({ numero: p.phone_number, negocio: nombre[p.org_id] || '(org desconocida)' });
          }
        }
      }
    } catch (_) {}

    const informe = buildSystemAudit({ llamadas: llamadas || [], esquema, entorno, version, numeros, numerosMudos });
    const to = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
    const prefijo = informe.severidad === 'critico' ? '🚨' : informe.severidad === 'aviso' ? '⚠️' : '✅';
    await enviar({ to, subject: `${prefijo} NodeFlow · auditoría técnica — ${informe.resumen}`, html: renderSystemAudit(informe, dias) });
    log.info(`Auditoría enviada: ${informe.resumen}`);
    return true;
  } catch (e) {
    log.error(`Auditoría técnica falló: ${e.message}`);
    return false;
  }
}

// ── Cron: cada día a las 07:30 (Madrid) ──────────────────────────────────────
// Antes del digest del fundador (08:00) y del email de salud de clientes (09:30):
// si algo técnico está roto, se sabe antes de leer los números de negocio.
let _interval = null, _ultimo = null;
function startSystemAuditCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    try {
      if (!require('../utils/leader').isLeader()) return;   // multi-réplica: solo el líder
      const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
      }).formatToParts(new Date()).map(x => [x.type, x.value]));
      const hoy = `${p.year}-${p.month}-${p.day}`;
      if (`${p.hour}:${p.minute}` === '07:30' && _ultimo !== hoy) {
        _ultimo = hoy;
        runSystemAudit().catch(() => {});
      }
    } catch (_) {}
  }, 60 * 1000);
  if (_interval.unref) _interval.unref();
  log.info('Auditoría técnica programada — cada día a las 07:30 (Madrid)');
}

module.exports = {
  buildSystemAudit, renderSystemAudit, runSystemAudit, startSystemAuditCron,
  PIEZAS, ENV_CRITICAS, OBJETIVO_MS, P95_ALERTA_MS, ROTAS_ALERTA,
};
