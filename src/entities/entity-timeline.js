// ============================================================
// NodeFlow — ENTIDADES v1: timeline universal de la ficha viva
// ------------------------------------------------------------
// Concepto de Twenty (activity timeline, solo la idea): la historia
// de la COSA es la unión cronológica de sus eventos propios
// (nf_entity_events), sus citas (nf_appointments.entity_id) y sus
// avisos (scheduled_reminders.entity_id) — enviados Y programados 🔔.
//
// buildEntityTimeline es PURA (testeable sin BD): recibe las filas
// crudas y devuelve items listos-para-pintar (título ya compuesto,
// cero joins en el cliente — lección 1.5). El orden es el natural de
// una ficha viva: lo PRÓXIMO primero (ascendente, lo más inminente
// arriba), después el pasado (descendente, lo más reciente arriba).
// ============================================================
'use strict';

// Cap de seguridad: la ficha pinta una historia, no un log infinito.
const MAX_ITEMS = 120;

// ─── Helpers puros ────────────────────────────────────────────────────────────

/** 'TXT:frase completa' → 'frase completa' (marcador interno del scheduler). */
function _stripTxt(s) {
  const str = String(s || '');
  return str.startsWith('TXT:') ? str.slice(4) : str;
}

/** Resumen legible del diff de un field_change: 'km: 100 → 200' (máx 3). */
function _diffSummary(properties, fieldLabels) {
  const props = (properties && typeof properties === 'object') ? properties : {};
  const parts = [];
  for (const [key, ch] of Object.entries(props)) {
    if (parts.length >= 3) { parts.push('…'); break; }
    if (!ch || typeof ch !== 'object') continue;
    const label   = (fieldLabels && fieldLabels[key]) || key;
    const antes   = (ch.antes === null || ch.antes === undefined || ch.antes === '') ? '—' : String(ch.antes);
    const despues = (ch.despues === null || ch.despues === undefined || ch.despues === '') ? '—' : String(ch.despues);
    parts.push(`${label}: ${antes} → ${despues}`);
  }
  return parts.join(' · ');
}

function _ts(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return isNaN(t) ? 0 : t;
}

/**
 * PURA — une eventos propios + citas + avisos en un solo timeline.
 * @param {object} input
 *   events:       filas de nf_entity_events   [{ id, happens_at, kind, title, properties, actor }]
 *   appointments: filas de nf_appointments    [{ id, date, time, service, status, patient_name }]
 *   reminders:    filas de scheduled_reminders [{ id, service_key, message_preview, channel, scheduled_for, status, sent_at }]
 *   fieldLabels:  { key → label } del tipo (para el resumen del diff)
 *   now:          Date de referencia (inyectable en tests)
 * @returns Array<{ at, kind, icon, title, meta, actor, upcoming }>
 */
function buildEntityTimeline({ events, appointments, reminders, fieldLabels, now } = {}) {
  const ref   = now || new Date();
  const items = [];

  // (a) Eventos propios de la entidad (ya grabados por el CRUD y la IA)
  const EVENT_ICON = { created: '✨', field_change: '✏️', note: '📝', ai_mention: '🤖', sent: '📤' };
  for (const ev of (events || [])) {
    const actor = ev.actor || 'staff';
    const meta  = ev.kind === 'field_change' ? _diffSummary(ev.properties, fieldLabels) : '';
    items.push({
      at:       ev.happens_at || null,
      kind:     'event:' + (ev.kind || 'note'),
      icon:     actor === 'ai' ? '🤖' : (EVENT_ICON[ev.kind] || '📝'),
      title:    (actor === 'ai' ? 'La IA — ' : '') + (ev.title || 'Actividad'),
      meta,
      actor,
      upcoming: false,
    });
  }

  // (b) Citas vinculadas (entity_id en nf_appointments)
  for (const a of (appointments || [])) {
    const at        = a.date ? `${a.date}T${a.time || '00:00'}` : null;
    const cancelled = a.status === 'cancelled';
    const future    = _ts(at) > ref.getTime();
    items.push({
      at,
      kind:     'appointment',
      icon:     cancelled ? '❌' : '📅',
      title:    (cancelled ? 'Cita cancelada' : (future ? 'Cita programada' : 'Cita')) + (a.service ? ' — ' + a.service : ''),
      meta:     [a.time || '', a.patient_name || ''].filter(Boolean).join(' · '),
      actor:    'system',
      upcoming: future && !cancelled,
    });
  }

  // (c) Avisos: enviados (historia) y pendientes/pospuestos (lo próximo, 🔔)
  for (const r of (reminders || [])) {
    const label = _stripTxt(r.message_preview) || String(r.service_key || '').replace(/^entity:/, '').replace(/[:_]/g, ' ');
    if (r.status === 'sent' && r.sent_at) {
      items.push({
        at: r.sent_at, kind: 'reminder_sent', icon: '📨',
        title: 'Aviso enviado — ' + label,
        meta: r.channel || 'whatsapp', actor: 'system', upcoming: false,
      });
    } else if (r.status === 'pending' || r.status === 'postponed') {
      items.push({
        at: r.scheduled_for || null, kind: 'reminder_upcoming', icon: '🔔',
        title: 'Aviso programado — ' + label,
        meta: (r.channel || 'whatsapp') + (r.status === 'postponed' ? ' · pospuesto' : ''),
        actor: 'system', upcoming: true,
      });
    }
    // cancelled/failed: ruido — fuera del timeline
  }

  // Orden de ficha viva: próximos primero (el más inminente arriba),
  // después el pasado (lo más reciente arriba).
  const upcoming = items.filter(i => i.upcoming).sort((a, b) => _ts(a.at) - _ts(b.at));
  const past     = items.filter(i => !i.upcoming).sort((a, b) => _ts(b.at) - _ts(a.at));
  return [...upcoming, ...past].slice(0, MAX_ITEMS);
}

// ─── Fetch org-scoped (consultas en PARALELO + merge puro; cero N+1) ─────────

/**
 * Carga las tres fuentes del timeline de UNA entidad en paralelo y las une.
 * Org-scoped en cada query. Best effort por fuente: si una tabla no está
 * (42P01 en instalaciones a medio migrar), esa fuente aporta [] y la ficha
 * sigue viva con las demás.
 */
async function fetchEntityTimeline({ orgId, entityId, entityType, db, now }) {
  const safe = (p) => p.then(r => r.data || [], () => []);

  const [events, appointments, reminders] = await Promise.all([
    safe(db.client.from('nf_entity_events')
      .select('id, happens_at, kind, title, properties, actor')
      .eq('organization_id', orgId).eq('entity_id', entityId)
      .order('happens_at', { ascending: false }).limit(80)),
    safe(db.client.from('nf_appointments')
      .select('id, date, time, service, status, patient_name')
      .eq('organization_id', orgId).eq('entity_id', entityId)
      .order('date', { ascending: false }).limit(40)),
    safe(db.client.from('scheduled_reminders')
      .select('id, service_key, message_preview, channel, scheduled_for, status, sent_at')
      .eq('org_id', orgId).eq('entity_id', entityId)
      .in('status', ['pending', 'postponed', 'sent'])
      .order('scheduled_for', { ascending: false }).limit(40)),
  ]);

  const fieldLabels = {};
  for (const f of ((entityType && entityType.fields) || [])) fieldLabels[f.key] = f.label || f.key;

  return buildEntityTimeline({ events, appointments, reminders, fieldLabels, now });
}

module.exports = { buildEntityTimeline, fetchEntityTimeline, MAX_ITEMS };
