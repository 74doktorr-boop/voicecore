'use strict';
// ============================================================
// NodeFlow — Informe de resultados AUDITADO (2026-07-18)
// El nº1 de "what_would_win_me" en la crítica ronda 3: "una prueba de 3-4
// semanas con MIS llamadas y un informe de cuántas cité DE VERDAD, auditado,
// con nombres — no solo el mensaje bonito del lunes". Esto es ese informe: cada
// cita listada (fecha, cliente, servicio, valor) para que el dueño la verifique
// una a una en su agenda, más el recuento honesto de llamadas que cerró el bot.
//
// HONESTIDAD DE ATRIBUCIÓN (Engineering Charter — nunca inflar):
//  · botBookedCalls = llamadas con outcome='booked' (acción incontestable del bot).
//  · appointments   = citas creadas en el periodo, con su precio real (o ticket
//    medio si no hay precio). Son filas REALES de la agenda: verificables.
//  · rescuedValue    = botBookedCalls × ticket medio (mismo criterio que el
//    informe semanal: NO el total del periodo, que incluye citas que el negocio
//    habría cogido igual). Se explica en el propio informe.
// Módulo PURO (sin BD): recibe filas ya leídas y devuelve el informe.
// ============================================================

/** Redondea a 2 decimales evitando ruido de coma flotante. PURA. */
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * @param {{calls:Array, appointments:Array, avgTicket:number, fromDate:string, toDate:string}} d
 *   calls: [{outcome, duration_ms, started_at}]  appointments: [{patient_name, service, date, price, status, created_at}]
 * @returns {object} informe auditado
 */
function buildTrialReport({ calls = [], appointments = [], avgTicket = 0, fromDate, toDate }) {
  const ticket = Number(avgTicket) || 0;
  const handledCalls = calls.length;
  const botBookedCalls = calls.filter(c => c.outcome === 'booked').length;

  // Citas reales del periodo (excluye canceladas), itemizadas y ordenadas.
  const items = (appointments || [])
    .filter(a => a.status !== 'cancelled')
    .map(a => ({
      date: a.date || '',
      name: a.patient_name || a.patientName || a.name || '—',
      service: a.service || '',
      value: money(Number(a.price) > 0 ? Number(a.price) : ticket),
      pricedFrom: Number(a.price) > 0 ? 'real' : (ticket > 0 ? 'ticket_medio' : 'sin_precio'),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const bookedValue = money(items.reduce((s, i) => s + i.value, 0));
  const rescuedValue = money(ticket > 0 ? botBookedCalls * ticket : 0);

  return {
    range: { from: fromDate, to: toDate },
    handledCalls,           // llamadas que atendió el asistente
    botBookedCalls,         // de ésas, cuántas terminaron en cita (auditable)
    appointments: items,    // citas del periodo, verificables una a una
    apptCount: items.length,
    bookedValue,            // suma del valor de esas citas
    rescuedValue,           // valor atribuible al bot (honesto), ticket×booked
    avgTicket: ticket,
    note: ticket > 0
      ? `Valor rescatado = ${botBookedCalls} llamadas que cerró el asistente × ${ticket}€ de ticket medio. Las citas de abajo son filas reales de tu agenda: puedes comprobarlas una a una.`
      : 'Configura tu ticket medio para estimar el valor en €. Las citas de abajo son filas reales de tu agenda: puedes comprobarlas una a una.',
  };
}

/** Informe → CSV (reusa el escaper anti-inyección del export). PURA. */
function trialReportCsv(report) {
  const { csvCell } = require('../api/data-export');
  const line = arr => arr.map(csvCell).join(',');
  const out = [];
  out.push('﻿INFORME DE RESULTADOS NODEFLOW');
  out.push(line(['Periodo', `${report.range.from} a ${report.range.to}`]));
  out.push(line(['Llamadas atendidas por el asistente', report.handledCalls]));
  out.push(line(['Llamadas que terminaron en cita', report.botBookedCalls]));
  out.push(line(['Valor rescatado (estimado)', report.avgTicket > 0 ? report.rescuedValue + ' EUR' : 'configura ticket medio']));
  out.push('');
  out.push(line(['Fecha', 'Cliente', 'Servicio', 'Valor (EUR)', 'Precio']));
  for (const i of report.appointments) {
    out.push(line([i.date, i.name, i.service, i.value, i.pricedFrom === 'real' ? 'real' : (i.pricedFrom === 'ticket_medio' ? 'ticket medio' : 'sin precio')]));
  }
  return out.join('\n');
}

module.exports = { buildTrialReport, trialReportCsv, money };
