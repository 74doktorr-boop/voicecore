// ============================================================
// NodeFlow — ENTIDADES v1.1: LA FICHA COMUNICA
// ------------------------------------------------------------
// La ficha viva no solo AVISA sola (materializador nocturno): ahora
// el dueño puede ENVIAR al cliente un resumen humano de su ficha —
// a mano desde la ficha viva, o automático al crearla (opt-in).
//
// buildEntitySummaryMessage es PURA (Engineering Charter): un WhatsApp
// cálido y corto a partir de las etiquetas+valores de la plantilla,
// NO un volcado de campos. Sector-aware por las labels del tipo.
// Emoji-safe: nunca deja un suplente UTF-16 huérfano que rompa
// encodeURIComponent en el cliente o pinte "�" en WhatsApp.
// ============================================================
'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Primer nombre para un saludo cálido ("Raúl García" → "Raúl"). '' si no hay. */
function _firstName(contact) {
  const raw = String((contact && contact.name) || '').trim();
  if (!raw) return '';
  return raw.split(/\s+/)[0];
}

/**
 * Elimina suplentes UTF-16 huérfanos (un pegado que cortó un emoji por la
 * mitad): encodeURIComponent LANZA con ellos y por otras vías se pintan como
 * "�" en WhatsApp. Espejo servidor de _fuWellFormed (portal.js). PURA.
 */
function wellFormed(s) {
  let out = '';
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {            // suplente alto…
      const d = str.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { out += str[i] + str[i + 1]; i++; }  // …con pareja
    } else if (!(c >= 0xDC00 && c <= 0xDFFF)) {  // bajo huérfano → fuera
      out += str[i];
    }
  }
  return out;
}

/** Fecha AAAA-MM-DD → "7/12/2026" (locale es-ES). Devuelve el crudo si no casa. */
function _fmtDate(v) {
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s)) return String(v);
  const d = new Date(s + 'T12:00:00');
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-ES');
}

/** Valor legible de un campo: label de select, fecha bonita, lista unida. '' si vacío. */
function _readableValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'date') return _fmtDate(value);
  if (field.type === 'boolean') return value === true || value === 'true' ? 'Sí' : 'No';
  if ((field.type === 'select' || field.type === 'multiselect') && Array.isArray(field.options)) {
    const arr = Array.isArray(value) ? value : [value];
    const labels = arr.map(v => {
      const opt = field.options.find(o => String(o.value) === String(v));
      return opt ? opt.label : String(v);
    }).filter(Boolean);
    return labels.join(', ');
  }
  if (Array.isArray(value)) return value.filter(x => x !== '' && x != null).join(', ');
  return String(value).trim();
}

/**
 * PURA — resumen cálido en español de UNA ficha para su dueño (el cliente).
 * Regla producto (Fundador): corto y humano, NUNCA un volcado de campos.
 * Usa los datos clave de la plantilla (show_in_list) con sus etiquetas y
 * valores; salta campos vacíos, notas y el propio identificador si no aporta.
 *
 *   "Hola Raúl 👋 Aquí tienes el resumen de tu Plan Hombro: 10 sesiones y
 *    próxima revisión el 7/12. Cualquier cosa, respóndenos por aquí."
 *
 * @param entityType fila/plantilla de nf_entity_types (fields, label_singular)
 * @param entity     { display_name, attrs }
 * @param contact    { name } — para el saludo (opcional)
 * @returns {string} mensaje emoji-safe listo para WhatsApp
 */
function buildEntitySummaryMessage(entityType, entity, contact) {
  const type   = entityType || {};
  const attrs  = (entity && entity.attrs) || {};
  const fields = type.fields || [];
  const name   = _firstName(contact);
  const label  = String((entity && entity.display_name) || type.label_singular || 'tu ficha').trim();

  // Campos clave: los que el sector marca como "de un vistazo" (show_in_list),
  // en su orden de plantilla. Las notas y campos largos nunca van al resumen.
  const shown = fields
    .filter(f => f.show_in_list && f.type !== 'note')
    .slice()
    .sort((a, b) => (a.position || 99) - (b.position || 99));

  const parts = [];
  for (const f of shown) {
    const val = _readableValue(f, attrs[f.key]);
    if (!val) continue;
    // El display_name YA lleva el/los identificador(es) principales — no los
    // repetimos como "Matrícula: 1234 ABC" si ya salen en el título.
    const inLabel = label.toLowerCase().indexOf(String(val).toLowerCase()) !== -1;
    if (inLabel) continue;
    const flabel = String(f.label || f.key)
      .replace(/\s*\([^)]*\)\s*$/, '')  // quita paréntesis de ayuda ("(€)", "(min)")
      .trim();
    parts.push(f.type === 'date' ? `${_lower(flabel)} el ${val}` : `${_lower(flabel)}: ${val}`);
  }

  const saludo = name ? `Hola ${name} 👋` : '¡Hola! 👋';
  let cuerpo;
  if (parts.length) {
    cuerpo = `Aquí tienes el resumen de tu ${label}: ${_joinNatural(parts)}.`;
  } else {
    // Sin datos clave rellenos: honesto y cálido, sin inventar.
    cuerpo = `Aquí tienes tu ficha: ${label}.`;
  }
  const cierre = 'Cualquier cosa, respóndenos por aquí.';

  return wellFormed(`${saludo} ${cuerpo} ${cierre}`);
}

/** minúscula inicial de una etiqueta ("Próxima revisión" → "próxima revisión"). */
function _lower(s) {
  const str = String(s || '');
  return str ? str.charAt(0).toLowerCase() + str.slice(1) : str;
}

/** Une con comas y una "y" final ("a, b y c"). PURA. */
function _joinNatural(arr) {
  if (arr.length <= 1) return arr.join('');
  if (arr.length === 2) return `${arr[0]} y ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`;
}

/**
 * Envía el resumen de una ficha a su dueño AHORA mismo, reutilizando el 100%
 * de la maquinaria de avisos (dispatch WA → SMS → Email respetando opt-outs).
 * Síncrono a propósito: el portal quiere una respuesta honesta ("enviado por
 * WhatsApp" / "el cliente no quiere que le escribamos"). Cuenta como 1 mensaje
 * del paquete (lo despacha el mismo motor que los recordatorios).
 *
 * Deja constancia en el timeline de la ficha (kind:'sent') SOLO si de verdad
 * se envió — así la historia no miente.
 *
 * @returns {Promise<{ok, reason?, channel?, message?}>}
 *   ok:false + reason:'no_contact'   → la ficha no tiene dueño vinculado
 *   ok:false + reason:'no_phone'     → el dueño no tiene teléfono ni email
 *   ok:false + reason:'do_not_contact' → el cliente pidió no recibir mensajes
 *   ok:false + reason:'send_failed'  → fallaron todos los canales
 *   ok:true  + channel:'whatsapp'|'sms'|'email'
 */
async function sendEntitySummary({ orgId, entityType, entity, db, actor = 'staff' }) {
  const { getDatabase } = require('../db/database');
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, reason: 'db_disabled' };
  if (!entity || !entity.contact_id) return { ok: false, reason: 'no_contact' };

  // Dueño (persona = contact): teléfono/email/nombre para el saludo y el envío
  const { data: contact } = await db.client.from('contacts')
    .select('name, phone, email')
    .eq('id', entity.contact_id).eq('org_id', orgId).maybeSingle();
  if (!contact || (!contact.phone && !contact.email)) return { ok: false, reason: 'no_phone' };

  // Opt-out / do-not-contact: si pidió no recibir nada, no le escribimos.
  let memory = null;
  try {
    const { getContactMemory } = require('../lifecycle/call-memory');
    memory = await getContactMemory(entity.contact_id, orgId);
  } catch (_) {}
  const allBlocked = memory && memory.no_whatsapp && memory.no_sms && memory.no_email;
  if (allBlocked) return { ok: false, reason: 'do_not_contact' };

  const text = buildEntitySummaryMessage(entityType, entity, contact);

  // Reutiliza el dispatcher del motor de recordatorios (WA→SMS→Email). El
  // marcador TXT: hace que el texto viaje ÍNTEGRO en la plantilla-portadora
  // nodeflow_aviso (aprobada en Meta), igual que los avisos personalizados.
  const { dispatch } = require('../lifecycle/scheduler');
  const { data: org } = await db.client.from('organizations')
    .select('name').eq('id', orgId).maybeSingle();
  const reminder = {
    id:              `entity-summary:${entity.id}`,
    org_id:          orgId,
    contact_id:      entity.contact_id,
    entity_id:       entity.id,
    service_key:     'aviso_resumen_ficha',   // aviso_* → nunca se cancela por cita futura
    channel:         'whatsapp',
    message_preview: 'TXT:' + text,
  };
  const contactWithOrg = { ...contact, _orgName: (org && org.name) || '' };

  const result = await dispatch(reminder, contactWithOrg, memory || {});
  if (!result.ok) return { ok: false, reason: 'send_failed' };

  // Timeline: "Resumen enviado al cliente 📤 · whatsapp" (best-effort)
  try {
    await db.client.from('nf_entity_events').insert({
      organization_id: orgId,
      entity_id:       entity.id,
      kind:            'sent',
      title:           `Resumen enviado al cliente 📤 · ${result.channel}`,
      properties:      { channel: result.channel, summary: text },
      actor:           actor === 'ai' ? 'ai' : 'staff',
    });
    // La ficha "se mueve" (sube en las listas por updated_at)
    await db.client.from('nf_entities')
      .update({ updated_at: new Date().toISOString() })
      .eq('organization_id', orgId).eq('id', entity.id)
      .then(undefined, () => {});
  } catch (_) {}

  return { ok: true, channel: result.channel, message: text };
}

module.exports = {
  buildEntitySummaryMessage,
  wellFormed,
  sendEntitySummary,
};
