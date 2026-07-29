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
    this._hydrated = false;     // true tras cargar el histórico de citas al arranque
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
    // `staff` se escribe SOLO si la cita tiene profesional (ver _persistWithRetry).
    // Escribirlo siempre rompería TODOS los inserts en cualquier entorno donde la
    // migración db/migration-appointment-staff.sql aún no esté aplicada — que es
    // exactamente el fallo "cita fantasma" que este módulo existe para evitar.
    const staff = apt.staff ? { staff: String(apt.staff) } : {};
    return {
      ...staff,
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
      location:        apt.location  || null,   // multi-sede: centro de la cita
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
      location:     row.location  || null,   // multi-sede (columna ausente → null)
      // Profesional que atiende. Sin esto, tras un reinicio apt.staff quedaba
      // undefined → _isSlotTaken dejaba de aplicar la excepción por profesional
      // → la agenda de una peluquería con 2 personas colapsaba a 1:1 y el
      // negocio perdía media capacidad hasta el siguiente deploy.
      staff:        row.staff     || null,
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
      // Enlace con el evento de Outlook (integración Outlook). Mismo criterio:
      // columna ausente → undefined → null (no rompe si la migración no está).
      outlookEventId: row.outlook_event_id || null,
      createdAt:    row.created_at,
      updatedAt:    row.updated_at,
    };
  }

  // ── Cargar al arranque ────────────────────────────────────
  // Devuelve array de appointments para cargar en el Map del scheduler.
  // Solo carga citas no canceladas de los últimos 90 días + futuras.
  async loadAll() {
    if (!this._enabled) return [];
    const cutoff = new Date(Date.now() - 90 * 86400000)
      .toISOString().slice(0, 10);

    const { data, error } = await this._client
      .from('nf_appointments')
      .select('*')
      .gte('date', cutoff)
      .order('date', { ascending: true });

    // LANZA en fallo (antes devolvía [] en silencio): un array vacío por ERROR
    // era indistinguible de "no hay citas" → el Map quedaba vacío, las citas se
    // volvían invisibles y el bot podía re-reservar el mismo hueco. Ahora el
    // llamante (server) distingue el fallo, reintenta y avisa.
    if (error) throw new Error(`loadAll: ${error.message}`);

    const apts = (data || []).map(r => this._fromRow(r));
    this._hydrated = true;
    log.info(`Loaded ${apts.length} appointments from Supabase`);
    return apts;
  }

  // ¿Se cargó el histórico de citas al arranque? false hasta una carga OK.
  isHydrated() { return !!this._hydrated; }

  /** El arranque registra aquí su promesa de hidratación (ver server.js). */
  setHydrationPromise(p) { this._hydrationPromise = p; }

  /**
   * Espera a que la agenda esté cargada, con techo de tiempo.
   *
   * A4 (auditoría 2026-07-29): `isHydrated()` existía y NO lo invocaba nadie.
   * Entre `server.listen()` y el final de la carga había una ventana en la que
   * el Map de citas estaba vacío: _isSlotTaken devolvía "libre" para TODO y el
   * bot ofrecía —y reservaba— huecos ya ocupados. Con un redeploy a las 10:00 y
   * una llamada a las 10:00:03, eso pasa de verdad.
   *
   * Se espera en el webhook de voz (antes de devolver el TeXML), no en el
   * arranque: /health tiene que responder desde el primer segundo. Una vez
   * hidratado, la promesa ya está resuelta y no cuesta nada.
   *
   * Fail-open a propósito: si vence el plazo se sigue igualmente. Perder la
   * llamada es peor que arriesgar un solape, y la BD tiene su propio constraint
   * anti-solape como última red.
   *
   * @returns {Promise<boolean>} true si está hidratado; false si venció el plazo
   */
  async whenHydrated(timeoutMs = 5000) {
    if (!this._enabled || this._hydrated) return true;
    if (!this._hydrationPromise) return false;
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      if (timer.unref) timer.unref();
    });
    try {
      const done = await Promise.race([this._hydrationPromise.then(() => true).catch(() => false), deadline]);
      if (!done) log.warn(`Agenda aún sin cargar tras ${timeoutMs}ms — se atiende igual (la BD tiene el anti-solape)`);
      return done && this._hydrated;
    } finally {
      clearTimeout(timer);
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
    const p = this._persistWithRetry(this._toRow(apt), apt, 1);
    // Integraciones (conector): empuja el evento a los sistemas externos del
    // negocio (webhook firmado). Fire-and-forget, fail-open y NO-OP si el
    // negocio no tiene integración configurada — nunca afecta a la persistencia.
    p.then(ok => {
      if (!ok || !apt.businessId) return;
      const event = apt.status === 'cancelled' ? 'appointment.cancelled' : 'appointment.saved';
      require('../integrations/connector').emit(apt.businessId, event, {
        id: apt.id, patientName: apt.patientName, phone: apt.phone || null,
        service: apt.service, date: apt.date, time: apt.time,
        duration: apt.duration || null, status: apt.status || 'confirmed',
        location: apt.location || null,
      });
    }).catch(() => {});
    return p;
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
      // Columna `staff` ausente = migración sin aplicar. NO se pierde la cita:
      // se guarda sin profesional y se GRITA en los logs. Reintentar tal cual
      // fallaría las 3 veces y acabaría en "cita no persistida" — el peor
      // resultado posible por una migración pendiente.
      if (this._isMissingColumn(error, 'staff') && row.staff !== undefined) {
        log.error(`⚠️ nf_appointments.staff NO EXISTE en la BD — la cita ${apt.id} se guarda SIN profesional. Ejecuta db/migration-appointment-staff.sql en Supabase (hasta entonces, dos profesionales NO pueden compartir hueco).`);
        const { staff, ...withoutStaff } = row;
        return this._persistWithRetry(withoutStaff, apt, attempt);
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

  /**
   * ¿El error de PostgREST dice que falta ESA columna?
   * PostgREST devuelve PGRST204 ("Could not find the 'x' column") o 42703
   * ("column ... does not exist") según la operación. Puro y testeable.
   */
  _isMissingColumn(error, column) {
    if (!error) return false;
    const code = String(error.code || '');
    const msg  = String(error.message || '');
    if (code !== 'PGRST204' && code !== '42703' && !/does not exist|could not find/i.test(msg)) return false;
    return msg.includes(column);
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
    // F5: además del dueño, que se entere NodeFlow. Una cita que no se guarda es
    // un fallo NUESTRO: el dueño recibe el aviso para apuntarla a mano, pero si
    // nadie del equipo lo ve, el patrón (una BD que va mal, un constraint que
    // rechaza de más) no se detecta hasta que se acumulan las quejas.
    try {
      require('../monitoring/error-tracker').capture(
        new Error(`Cita no persistida (${apt.businessId}): ${reason}`),
        'appointment_not_persisted',
        { orgId: apt.businessId, cita: apt.id, cuando: `${apt.date} ${apt.time}`, cliente: apt.patientName || '—' },
      );
    } catch (_) {}
    try {
      if (this._notify) return this._notify(msg, apt.businessId);
      require('../tools/executor')._notifyOwner(msg, apt.businessId);
    } catch (_) {}
  }

  // ── Actualización parcial ─────────────────────────────────
  // Devuelve una PROMESA {ok, count} para que quien lo necesite (p.ej. cancelar
  // desde el portal) pueda ESPERAR y VERIFICAR la escritura. Los llamantes
  // fire-and-forget siguen igual (ignoran el retorno).
  patch(id, fields) {
    if (!this._enabled) return { ok: true, count: 0, skipped: true };
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
    if (fields.location     !== undefined) dbFields.location      = fields.location;
    if (fields.staff        !== undefined) dbFields.staff         = fields.staff;
    // `duration` faltaba: el portal permite cambiar el servicio pero la duración
    // nunca se recalculaba ni se persistía, así que un "Corte" (30 min) que pasa
    // a "Coloración" (90 min) seguía ocupando 30 y el bot vendía el hueco
    // solapado (AG-10).
    if (fields.duration     !== undefined) dbFields.duration      = fields.duration;
    if (fields.wa_confirmed     !== undefined) dbFields.wa_confirmed     = fields.wa_confirmed;
    if (fields.reminder_sent    !== undefined) dbFields.reminder_sent    = fields.reminder_sent;
    if (fields.review_requested !== undefined) dbFields.review_requested = fields.review_requested;
    if (fields.noShowNotified   !== undefined) dbFields.no_show_notified = fields.noShowNotified;
    if (fields.cancelledAt  !== undefined) dbFields.cancelled_at  = fields.cancelledAt;
    if (fields.cancelledBy  !== undefined) dbFields.cancelled_by  = fields.cancelledBy;
    if (fields.googleEventId !== undefined) dbFields.google_event_id = fields.googleEventId;
    if (fields.outlookEventId !== undefined) dbFields.outlook_event_id = fields.outlookEventId;
    if (fields.updatedAt    !== undefined) dbFields.updated_at    = fields.updatedAt;

    if (!Object.keys(dbFields).length) return { ok: true, count: 0, skipped: true };

    return this._client
      .from('nf_appointments')
      .update(dbFields)
      .eq('id', id)
      .select('id')
      .then(({ data, error }) => {
        if (error) { log.warn(`patch ${id}: ${error.message}`); return { ok: false, count: 0, error: error.message }; }
        return { ok: true, count: (data || []).length };
      })
      .catch(e => { log.warn(`patch exception ${id}: ${e.message}`); return { ok: false, count: 0, error: e.message }; });
  }
}

// Singleton
const appointmentsStore = new AppointmentsStore();
module.exports = { appointmentsStore, AppointmentsStore };
