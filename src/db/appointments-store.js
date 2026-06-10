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
      price:           apt.price     || 0,
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
  // Fire-and-forget: no bloquea el scheduler
  upsert(apt) {
    if (!this._enabled) return;
    const row = this._toRow(apt);
    this._client
      .from('nf_appointments')
      .upsert(row, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) log.warn(`upsert ${apt.id}: ${error.message}`);
      })
      .catch(e => log.warn(`upsert exception ${apt.id}: ${e.message}`));
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
module.exports = { appointmentsStore };
