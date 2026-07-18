'use strict';
// ============================================================
// NodeFlow — Exportación COMPLETA de datos (portabilidad) 2026-07-18
// La crítica ronda 3 lo pidió por escrito y repetido como desbloqueo del tier
// alto: "garantía de que puedo exportar TODOS mis datos (clientes, historial,
// citas) en formato abierto, sin pedirlo por soporte". Esto es esa garantía,
// hecha producto: un ZIP self-service con CSVs abiertos + un LEEME que declara
// la portabilidad. Sin lock-in = una objeción de confianza menos.
//
// Generador PURO (sin express ni BD) para poder testearlo: recibe los datos ya
// leídos y devuelve un Buffer .zip. Anti-inyección de fórmulas CSV heredado del
// export de contactos (celda que empieza por = + - @ → apóstrofo neutralizador,
// porque el nombre lo dicta quien LLAMA: vector cross-tenant a la hoja del dueño).
// ============================================================

/** Escapa una celda CSV (comillas, comas, saltos) y neutraliza fórmulas. PURA. */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Filas (array de arrays) → texto CSV con cabecera y BOM (Excel-friendly). PURA. */
function toCsv(header, rows) {
  const line = arr => arr.map(csvCell).join(',');
  return '﻿' + line(header) + '\n' + rows.map(line).join('\n');
}

const _d = v => (v ? new Date(v).toLocaleDateString('es-ES') : '');

/** contactos crudos → CSV. PURA. */
function contactsCsv(contacts) {
  const header = ['Nombre', 'Teléfono', 'Email', 'Llamadas', 'Última llamada', 'Etiquetas', 'Notas', 'Cliente desde'];
  const rows = (contacts || []).map(c => [
    c.name, c.phone, c.email, c.call_count || 0, _d(c.last_call_at),
    Array.isArray(c.tags) ? c.tags.join(' · ') : '', c.notes, _d(c.created_at),
  ]);
  return toCsv(header, rows);
}

/** citas crudas → CSV. PURA. Acepta el shape del scheduler (patientName/name…). */
function appointmentsCsv(appointments) {
  const header = ['Fecha', 'Hora', 'Cliente', 'Teléfono', 'Servicio', 'Profesional', 'Centro', 'Estado', 'Origen', 'Notas', 'Creada'];
  const rows = (appointments || []).map(a => [
    a.date || '', a.time || '', a.patientName || a.name || '', a.phone || '',
    a.service || '', a.staff || a.professional || '', a.location || '',
    a.status || '', a.createdByAi || a.source === 'ai' ? 'Asistente IA' : (a.source || 'manual'),
    a.notes || '', _d(a.createdAt || a.created_at),
  ]);
  return toCsv(header, rows);
}

const README = (bizName, stamp) =>
`EXPORTACIÓN DE DATOS — ${bizName || 'Tu negocio'}
Generada el ${stamp} desde NodeFlow.

Este archivo contiene TODOS tus datos en formato abierto (CSV, que abre Excel,
Numbers, Google Sheets o cualquier programa):

  · clientes.csv — tu lista de clientes con su histórico de llamadas.
  · citas.csv    — todas las citas (agendadas por el asistente o a mano).

TU GARANTÍA DE PORTABILIDAD
Estos datos son tuyos. Puedes descargarlos tú mismo, cuando quieras, desde el
portal (Clientes → "Descargar todo"), sin pedírnoslo y sin coste. Si algún día
dejas NodeFlow, te los llevas contigo. Sin ataduras.

¿Dudas? Escríbenos por WhatsApp.
`;

/**
 * Construye el ZIP de portabilidad. Async porque jszip comprime en async.
 * @param {{bizName?:string, contacts:Array, appointments:Array, stamp:string}} data
 * @returns {Promise<Buffer>}
 */
async function buildExportZip({ bizName, contacts, appointments, stamp }) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('LEEME.txt', README(bizName, stamp));
  zip.file('clientes.csv', contactsCsv(contacts));
  zip.file('citas.csv', appointmentsCsv(appointments));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { csvCell, toCsv, contactsCsv, appointmentsCsv, buildExportZip };
