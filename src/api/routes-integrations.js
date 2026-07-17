'use strict';
// ============================================================
// NodeFlow — Rutas de INGRESO de integraciones (2026-07-17)
// El otro lado del conector: un sistema externo (PMS del negocio, Zapier…)
// empuja SUS reservas/cancelaciones a NodeFlow para que el bot NO haga
// overbooking. Reutiliza scheduler.bookAppointment/cancelAppointment (mismos
// caminos probados que usan las tools del bot: validan, comprueban solape y
// persisten). Autenticado con HMAC (inboundSecret del negocio). INERTE si el
// negocio no tiene integración configurada.
// ============================================================

const express = require('express');
const { verifyInbound, configFor } = require('../integrations/connector');
const { Logger } = require('../utils/logger');
const log = new Logger('INTEGRATIONS');

function setupIntegrationRoutes(app, deps = {}) {
  const getScheduler = () => deps.scheduler || require('../scheduling/scheduler').scheduler;
  const router = express.Router();

  // Verifica la firma HMAC entrante con el inboundSecret del negocio.
  async function auth(req, res, next) {
    try {
      const cfg = await configFor(req.params.orgId, deps.configOpts || {});
      const secret = cfg && cfg.inboundSecret;
      if (!secret) return res.status(404).json({ error: 'integración no configurada para este negocio' });
      const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
      const ok = verifyInbound({
        rawBody: raw,
        signature: req.get('X-NodeFlow-Signature'),
        timestamp: req.get('X-NodeFlow-Timestamp'),
        secret,
      });
      if (!ok) { log.warn(`[${req.params.orgId}] ingreso con firma inválida — 401`); return res.status(401).json({ error: 'firma inválida' }); }
      req._orgId = req.params.orgId;
      next();
    } catch (e) { log.warn(`auth ingreso: ${e.message}`); return res.status(500).json({ error: 'error interno' }); }
  }

  // Comprobación de conectividad/credenciales (firmado).
  router.post('/:orgId/ping', auth, (req, res) => res.json({ ok: true, org_id: req._orgId }));

  // Crear/bloquear una cita que viene del sistema externo.
  router.post('/:orgId/appointments', auth, (req, res) => {
    const b = req.body || {};
    if (!b.date || !b.time) return res.status(400).json({ success: false, error: 'faltan date/time' });
    const r = getScheduler().bookAppointment(req._orgId, {
      patientName: b.patientName || b.name || 'Cliente',
      phone: b.phone, email: b.email, service: b.service,
      date: b.date, time: b.time, notes: b.notes, location: b.location,
    });
    if (!r || !r.success) return res.status(409).json({ success: false, error: (r && r.error) || 'no se pudo crear' });
    log.info(`[${req._orgId}] cita externa creada: ${r.appointment.id} (${b.date} ${b.time})`);
    return res.status(201).json({ success: true, id: r.appointment.id });
  });

  // Cancelar una cita (por id + nombre, como las tools del bot).
  router.post('/:orgId/appointments/:id/cancel', auth, (req, res) => {
    const b = req.body || {};
    const r = getScheduler().cancelAppointment(req.params.id, b.patientName || b.name || '', req._orgId);
    if (!r || !r.success) return res.status(404).json({ success: false, error: (r && r.error) || 'no encontrada' });
    log.info(`[${req._orgId}] cita externa cancelada: ${req.params.id}`);
    return res.json({ success: true });
  });

  app.use('/api/integrations', router);
  log.info('Rutas de ingreso de integraciones montadas en /api/integrations (INERTE sin inboundSecret)');
}

module.exports = { setupIntegrationRoutes };
