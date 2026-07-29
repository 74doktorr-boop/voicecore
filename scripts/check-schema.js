#!/usr/bin/env node
'use strict';
// ============================================================
// NodeFlow — ¿Qué hay REALMENTE en la base de datos?
//
// POR QUÉ EXISTE (auditoría 2026-07-29):
// db/pending-migrations.md se mantenía A MANO y llevaba dos semanas sin tocarse.
// Declaraba pendientes CINCO migraciones que estaban aplicadas. Dos auditorías
// independientes concluyeron a partir de ese fichero que producción estaba
// perdiendo todas las llamadas y todas las citas. Era falso — se comprobó
// consultando la BD. Un documento de estado que induce a error es peor que no
// tenerlo: hace perder tiempo y, lo que es peor, hace desconfiar de lo que sí
// funciona.
//
// Este script pregunta a la base de datos en vez de creerse un .md. SOLO LECTURA:
// hace `select ... limit 1` sobre columnas concretas; PostgREST devuelve un error
// identificable si la tabla o la columna no existen.
//
//   node scripts/check-schema.js
//
// Salida: OK / FALTA por cada comprobación, y código de salida 1 si falta algo
// CRÍTICO (lo que rompe persistencia o protecciones), para poder usarlo en CI.
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno.');
  process.exit(2);
}
const sb = createClient(url, key);

// [tabla, columnas, etiqueta, crítico, qué se rompe si falta]
const COMPROBACIONES = [
  ['nf_calls', 'id', 'tabla nf_calls', true, 'no se persiste ninguna llamada'],
  ['nf_calls', 'id,ai_decisions', 'nf_calls.ai_decisions (caja negra)', true,
    'el upsert de cierre falla ENTERO: se pierden transcripción, outcome, métricas y minutos de TODAS las llamadas'],
  ['nf_calls', 'id,followup_at,followup_sent', 'nf_calls.followup_at/sent', false, 'el recuperador de seguimientos no funciona'],
  ['nf_appointments', 'id', 'tabla nf_appointments', true, 'no se persiste ninguna cita'],
  ['nf_appointments', 'id,location', 'nf_appointments.location (multi-sede)', true,
    '_toRow envía siempre location: TODOS los upserts de cita fallan'],
  ['nf_appointments', 'id,staff', 'nf_appointments.staff (profesional)', false,
    'la cita se guarda SIN profesional: dos profesionales no pueden compartir hueco y, tras reiniciar, la agenda colapsa a 1:1'],
  ['nf_appointments', 'id,google_event_id', 'nf_appointments.google_event_id', false, 'los eventos de Google quedan de fantasma al cancelar'],
  ['nf_appointments', 'id,outlook_event_id', 'nf_appointments.outlook_event_id', false, 'ídem con Outlook'],
  ['nf_appointments', 'id,price', 'nf_appointments.price', false, 'sin precio real, el valor se estima con el ticket medio'],
  ['contact_memory', 'id,no_calls', 'contact_memory.no_calls (opt-out de voz)', false, '"no me llames" no se respeta en las salientes'],
  ['nf_campaign_calls', 'id', 'nf_campaign_calls (cola de salientes)', false, 'el dispatcher no lanza NINGUNA saliente (fail-closed)'],
  ['scheduled_reminders', 'id', 'scheduled_reminders', true, 'no hay motor de seguimientos ni recordatorios'],
  ['contacts', 'id', 'contacts', true, 'no hay CRM'],
  ['contact_memory', 'id', 'contact_memory', false, 'la IA no recuerda a los clientes'],
  ['nf_wa_messages', 'id', 'nf_wa_messages', false, 'no queda registro de los WhatsApp enviados'],
  ['knowledge_chunks', 'id', 'knowledge_chunks (RAG)', false, 'el asistente no consulta la base de conocimiento'],
  ['magic_tokens', 'token', 'magic_tokens', false, 'los enlaces de acceso no son de un solo uso'],
  ['audit_log', 'id', 'audit_log', false, 'sin registro de acciones de administración'],
  ['nf_phone_pool', 'id', 'nf_phone_pool', false, 'no se pueden asignar números'],
  ['nf_entities', 'id', 'nf_entities (fichas vivas)', false, 'la pestaña de entidades se oculta (NO-OP limpio)'],
  ['nf_learned_rules', 'id', 'nf_learned_rules', false, 'la pestaña de mejora no aprende'],
  ['nf_bonos', 'id', 'nf_bonos', false, 'bonos NO-OP'],
  ['nf_stays', 'id', 'nf_stays', false, 'estancias NO-OP'],
  ['nf_content', 'id', 'nf_content', false, 'los artículos SEO se generan (gastando GPT) y NO se guardan'],
  ['nf_waitlist', 'id', 'nf_waitlist', false, 'sin lista de espera'],
  ['nf_tasks', 'id', 'nf_tasks', false, 'sin tareas'],
];

const esFalta = (e) => {
  const c = String(e.code || ''), m = String(e.message || '');
  if (c === '42P01' || c === 'PGRST205') return 'NO EXISTE LA TABLA';
  if (c === '42703' || c === 'PGRST204' || /column .* does not exist|could not find/i.test(m)) return 'NO EXISTE LA COLUMNA';
  return null;
};

(async () => {
  console.log('\n▶ Esquema REAL en la base de datos (solo lectura)\n');
  let faltanCriticas = 0, faltanOtras = 0;

  for (const [tabla, cols, etiqueta, critico, rompe] of COMPROBACIONES) {
    const { error } = await sb.from(tabla).select(cols).limit(1);
    if (!error) { console.log(`  ✔  ${etiqueta}`); continue; }
    const falta = esFalta(error);
    if (!falta) { console.log(`  ?  ${etiqueta} — error inesperado: ${error.message}`); continue; }
    if (critico) faltanCriticas++; else faltanOtras++;
    console.log(`  ${critico ? '✖' : '!'}  ${etiqueta} — ${falta}`);
    console.log(`       → ${rompe}`);
  }

  console.log('\n▶ Estado de las llamadas (30 días)');
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: calls, error: e1 } = await sb.from('nf_calls')
    .select('status').gte('started_at', since).limit(5000);
  if (e1) console.log(`  no legible: ${e1.message}`);
  else {
    const por = {};
    for (const c of calls) por[c.status || 'null'] = (por[c.status || 'null'] || 0) + 1;
    console.log(`  ${calls.length} llamadas · ${JSON.stringify(por)}`);
  }

  const { data: pool } = await sb.from('nf_phone_pool').select('status').limit(500);
  if (pool) {
    const b = {}; for (const p of pool) b[p.status || 'null'] = (b[p.status || 'null'] || 0) + 1;
    console.log(`\n▶ Pool de números: ${JSON.stringify(b)}`);
    if (!b.available) console.log('  ! sin números disponibles → no se pueden dar altas nuevas');
  }

  console.log(faltanCriticas
    ? `\n✖ Faltan ${faltanCriticas} pieza(s) CRÍTICA(s). Aplica las migraciones correspondientes ANTES de desplegar.\n`
    : `\n✔ Todo lo crítico está aplicado.${faltanOtras ? ` (${faltanOtras} pieza(s) opcional(es) sin aplicar — ver arriba)` : ''}\n`);
  process.exit(faltanCriticas ? 1 : 0);
})().catch(e => { console.error(`\nFallo al comprobar el esquema: ${e.message}\n`); process.exit(2); });
