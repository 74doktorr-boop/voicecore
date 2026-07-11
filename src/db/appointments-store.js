'use strict';
// ============================================================
// NodeFlow — Appointments Store
// Persistencia de citas en Supabase.
// El scheduler sigue operando en memoria; este módulo
// actúa como capa de sincronización:
//   - Al arrancar: carga citas desde Supabase al Map en memoria
//   - Al crear/editar/cancelar: persiste en Supabase (fire-and-forget)
// Si Supabase no está disponible, el sistema funciona igual
// (solo en memoria, como antes).
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('APT-STORE');

class AppointmentsStore {
  constructor() {
    this._client = null;
    this._enabled = false;
    this._retryDelayMs = 400;   // backoff base entre reintentos (test lo baja a 0)
    this._notify = null;        // notificador inyectable (test); si null → _notifyOwner real
  }

  // ── Inicialización ────────────────────────────────────────
  init(supabaseClient) {
    if (!supabaseClient) return;
    this._client = supabaseClient;
    this._enabled = true;
    log.info('AppointmentsStore ready (Supabase)');
  }

  get enabled() { return this._enabled; }

  // ── Conversión: appointment object ↔ DB row ───────────────
  _toRow(apt) {
    return {
      id:              apt.id,
      organization_id: apt.businessId,
      patient_name:    apt.patientName,
      phone:           apt.phone     || null,
      email:           apt.email     || null,
      service:         apt.service,
      service_id:      apt.serviceId || null,
      date:            apt.date,
      time:            apt.time,
      duration:        apt.duration  || 30,
      // La columna es NUMERIC: un precio string ("15€") rechazaba el insert
      // entero y la cita quedaba solo en memoria (perdida en el deploy).
      price:           (() => {
        if (typeof apt.price === 'number' && isFinite(apt.price)) return apt.price;
        const m = String(apt.price || '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
      })(),
      notes:           apt.notes     || null,
      status:          apt.status    || 'confirmed',
      wa_confirmed:     apt.wa_confirmed     || false,
      reminder_sent:     apt.reminder_sent     || false,
      review_requested:  apt.review_requested  || false,
      no_show_notified:  apt.noShowNotified    || false,
      cancelled_at:    apt.cancelledAt  || null,
      cancelled_by:    apt.cancelledBy  || null,
      created_at:      apt.createdAt    || new Date().toISOString(),
      updated_at:      apt.updatedAt    || new Date().toISOString(),
    };
  }

  _fromRow(row) {
    return {
      id:           row.id,
      businessId:   row.organization_id,
      patientName:  row.patient_name,
      phone:        row.phone     || '',
      email:        row.email     || null,
      service:      row.service,
      serviceId:    row.service_id || row.service,
      date:         row.date,
      time:         row.time,
      duration:     row.duration  || 30,
      price:        row.price     || 0,
      notes:        row.notes     || null,
      status:       row.status    || 'confirmed',
      wa_confirmed:     row.wa_confirmed     || false,
      reminder_sent:    row.reminder_sent    || false,
      review_requested: row.review_requested || false,
      noShowNotified:   row.no_show_notified || false,
      cancelledAt:  row.cancelled_at  || null,
      cancelledBy:  row.cancelled_by  || null,
      // Enlace con el evento de Google Calendar (Fase 3). Si la columna aún no
      // existe (migración sin aplicar), row.google_event_id es undefined → null.
      googleEventId: row.google_event_id || null,
      createdAt:    row.created_at,
      updatedAt:    row.updated_at,
    };
  }

  // ── Cargar al arranque ────────────────────────────────────
  // Devuelve array de appointments para cargar en el Map del scheduler.
  // Solo carga citas no canceladas de los últimos 90 días + futuras.
  async loadAll() {
    if (!this._enabled) return [];
    try {
      const cutoff = new Date(Date.now() - 90 * 86400000)
        .toISOString().slice(0, 10);

      const { data, error } = await this._client
        .from('nf_appointments')
        .select('*')
        .gte('date', cutoff)
        .order('date', { ascending: true });

      if (error) {
        log.warn(`loadAll error: ${error.message}`);
        return [];
      }

      const apts = (data || []).map(r => this._fromRow(r));
      log.info(`Loaded ${apts.length} appointments from Supabase`);
      return apts;
    } catch (e) {
      log.warn(`loadAll exception: ${e.message}`);
      return [];
    }
  }

  // ── Persistir (upsert) ────────────────────────────────────
  // Fire-and-forget para el llamante (no bloquea el scheduler), pero por dentro
  // REINTENTA los fallos transitorios y, si aun así no persiste, AVISA al dueño.
  // Antes era un solo intento tragado: un hipo de Supabase = cita fantasma que
  // el bot confirmó al cliente y desaparecía en el siguiente deploy, en silencio.
  // Devuelve una promesa (por si algún día se quiere await antes de confirmar).
  upsert(apt) {
    if (!this._enabled) return Promise.resolve(false);
    return this._persistWithRetry(this._toRow(apt), apt, 1);
  }

  async _persistWithRetry(row, apt, attempt) {
    const MAX = 3;
    try {
      const { error } = await this._client
        .from('nf_appointments')
        .upsert(row, { onConflict: 'id' });
      if (!error) return true;
      // Colisión de hueco rechazada por la BD. NO se reintenta — el hueco está
      // ocupado. Dos códigos posibles:
      //   23505 = unique_violation    → índice uniq_active_slot (misma hora exacta)
      //   23P01 = exclusion_violation → constraint nf_appointments_no_overlap
      //           (SOLAPE parcial por duración: 10:00+45min vs 10:30)
      // El bot pudo confirmar un doble → avisar al dueño.
      if (error.code === '23505' || error.code === '23P01') {
        log.warn(`⚠️ Slot collision ${apt.id} (${apt.businessId} ${apt.date} ${apt.time}) — hueco ya ocupado [${error.code}]`);
        this._alertLostAppointment(apt, 'ese hueco ya estaba ocupado (posible doble reserva)');
        return false;
      }
      throw new Error(error.message);
    } catch (e) {
      if (attempt < MAX) {
        await new Promise(r => setTimeout(r, this._retryDelayMs * attempt));
        return this._persistWithRetry(row, apt, attempt + 1);
      }
      log.error(`❌ CITA NO PERSISTIDA ${apt.id} (${apt.businessId} ${apt.date} ${apt.time}) tras ${MAX} intentos: ${e.message}`);
      this._alertLostAppointment(apt, 'no se pudo guardar por un error técnico');
      return false;
    }
  }

  // Una cita que no se guarda deja de ser SILENCIOSA: el dueño recibe un aviso
  // para apuntarla a mano y llamar al cliente. Nunca lanza.
  _alertLostAppointment(apt, reason) {
    const msg =
      `⚠️ *Cita que no se pudo guardar — NodeFlow*\n` +
      `━━━━━━━━━━━━\n` +
      `Se registró una cita en la llamada pero ${reason}.\n` +
      `👤 ${apt.patientName || '—'}   📞 ${apt.phone || 'sin número'}\n` +
      `📅 ${apt.date} a las ${apt.time}${apt.service ? ' · ' + apt.service : ''}\n` +
      `━━━━━━━━━━━━\n` +
      `Apúntala a mano y llama al cliente para confirmar. NodeFlow`;
    try {
      if (this._notify) return this._notify(msg, apt.businessId);
      require('../tools/executor')._notifyOwner(msg, apt.businessId);
    } catch (_) {}
  }

  // ── Actualización parcial ─────────────────────────────────
  patch(id, fields) {
    if (!this._enabled) return;
    // Convertir campos de camelCase a snake_case para la DB
    const dbFields = {};
    if (fields.status       !== undefined) dbFields.status        = fields.status;
    if (fields.patientName  !== undefined) dbFields.patient_name  = fields.patientName;
    if (fields.phone        !== undefined) dbFields.phone         = fields.phone;
    if (fields.email        !== undefined) dbFields.email         = fields.email;
    if (fields.service      !== undefined) dbFields.service       = fields.service;
    if (fields.date         !== undefined) dbFields.date          = fields.date;
    if (fields.time         !== undefined) dbFields.time          = fields.time;
    if (fields.notes        !== undefined) dbFields.notes         = fields.notes;
    if (fields.wa_confirmed     !== undefined) dbFields.wa_confirmed     = fields.wa_confirmed;
    if (fields.reminder_sent    !== undefined) dbFields.reminder_sent    = fields.reminder_sent;
    if (fields.review_requested !== undefined) dbFields.review_requested = fields.review_requested;
    if (fields.noShowNotified   !== undefined) dbFields.no_show_notified = fields.noShowNotified;
    if (fields.cancelledAt  !== undefined) dbFields.cancelled_at  = fields.cancelledAt;
    if (fields.cancelledBy  !== undefined) dbFields.cancelled_by  = fields.cancelledBy;
    if (fields.googleEventId !== undefined) dbFields.google_event_id = fields.googleEventId;
    if (fields.updatedAt    !== undefined) dbFields.updated_at    = fields.updatedAt;

    if (!Object.keys(dbFields).length) return;

    this._client
      .from('nf_appointments')
      .update(dbFields)
      .eq('id', id)
      .then(({ error }) => {
        if (error) log.warn(`patch ${id}: ${error.message}`);
      })
      .catch(e => log.warn(`patch exception ${id}: ${e.message}`));
  }
}

// Singleton
const appointmentsStore = new AppointmentsStore();
module.exports = { appointmentsStore, AppointmentsStore };
