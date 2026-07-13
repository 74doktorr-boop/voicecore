// portal-mock-server.js
// Standalone Node.js mock server for the NodeFlow portal frontend.
// NO real backend / Supabase. Neutral fictional demo data.
// Purpose: render every portal section populated, for clean screenshots.
//
//   node portal-mock-server.js [port]     (default 8378)
//
// Serves static files from ../../../../voicecore/public (resolved from the
// project root below) and mocks all /api/* endpoints the portal hits.
// Built on Node's http module only. No dependencies.

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = parseInt(process.argv[2], 10) || 8378;

// ── Locate the project public/ dir ────────────────────────────────────────
// Resolved relative to this file (scripts/guia-screenshots/ → ../../public).
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

// ── Helpers ────────────────────────────────────────────────────────────────
function iso(daysFromNow, hour, min) {
  const d = new Date();
  d.setDate(d.getDate() + (daysFromNow || 0));
  if (hour != null) d.setHours(hour, min || 0, 0, 0);
  return d.toISOString();
}
// YYYY-MM-DD local
function dateStr(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + (daysFromNow || 0));
  return d.toLocaleDateString('sv-SE');
}
function unixDaysAgo(days) {
  return Math.floor((Date.now() - days * 86400000) / 1000);
}

const NF_NUMBER = '+34 843 000 111';
const BIZ_PHONE = '+34 943 000 000';

// ════════════════════════════════════════════════════════════════════════
//  SEED DATA — Clínica Dental Bidasoa (Irun), sector dental, plan pro
// ════════════════════════════════════════════════════════════════════════

const ME = {
  id: 'demo-org-0001',
  name: 'Clínica Dental Bidasoa',
  plan: 'pro',
  sector: 'dental',
  owner_email: 'demo@nodeflow.es',
  phone: BIZ_PHONE,
  number: NF_NUMBER,
  nodeflowNumber: NF_NUMBER,
  city: 'Irun',
  has_password: true,
  monthly_minutes_used: 186,
  monthly_minutes_limit: 500,
};

const CONTACTS = [
  { id: 'c1', displayName: 'María Etxeberria', phone: '+34 688 112 233', email: 'maria.etxeberria@example.com', callCount: 5, tags: ['Ortodoncia', 'Fiel'], lastCallAt: iso(-2, 11, 15) },
  { id: 'c2', displayName: 'Jon Agirre',       phone: '+34 655 447 781', email: 'jon.agirre@example.com',       callCount: 2, tags: ['Empaste'],           lastCallAt: iso(-6, 17, 40) },
  { id: 'c3', displayName: 'Aitor Sánchez',    phone: '+34 622 908 114', email: 'aitor.sanchez@example.com',    callCount: 8, tags: ['Limpieza', 'VIP'],   lastCallAt: iso(-1, 9, 5) },
  { id: 'c4', displayName: 'Nerea Goikoetxea', phone: '+34 699 330 552', email: 'nerea.goiko@example.com',      callCount: 3, tags: ['Revisión'],          lastCallAt: iso(-4, 13, 20) },
  { id: 'c5', displayName: 'Iker Muñoz',       phone: '+34 611 774 006', email: 'iker.munoz@example.com',       callCount: 1, tags: [],                    lastCallAt: iso(-120, 10, 0) },
  { id: 'c6', displayName: 'Lucía Fernández',  phone: '+34 677 221 908', email: 'lucia.fernandez@example.com',  callCount: 6, tags: ['Blanqueamiento'],     lastCallAt: iso(-3, 16, 10) },
  { id: 'c7', displayName: 'Unax Bilbao',      phone: '+34 644 559 217', email: 'unax.bilbao@example.com',      callCount: 2, tags: ['Urgencia'],          lastCallAt: iso(-9, 12, 45) },
  { id: 'c8', displayName: 'Ane Zubizarreta',  phone: '+34 633 880 145', email: 'ane.zubi@example.com',         callCount: 4, tags: ['Implante'],          lastCallAt: iso(-200, 15, 30) },
];
const ALL_TAGS = ['Ortodoncia', 'Empaste', 'Limpieza', 'Revisión', 'Blanqueamiento', 'Urgencia', 'Implante', 'VIP', 'Fiel'];

const APPOINTMENTS = [
  { id: 'a1', patientName: 'María Etxeberria', phone: '+34 688 112 233', service: 'Ortodoncia · revisión', date: dateStr(0),  time: '10:00', status: 'confirmed' },
  { id: 'a2', patientName: 'Aitor Sánchez',    phone: '+34 622 908 114', service: 'Limpieza dental',        date: dateStr(0),  time: '12:30', status: 'confirmed' },
  { id: 'a3', patientName: 'Jon Agirre',       phone: '+34 655 447 781', service: 'Empaste',                date: dateStr(1),  time: '09:30', status: 'pending'   },
  { id: 'a4', patientName: 'Nerea Goikoetxea', phone: '+34 699 330 552', service: 'Revisión',               date: dateStr(2),  time: '16:00', status: 'confirmed' },
  { id: 'a5', patientName: 'Lucía Fernández',  phone: '+34 677 221 908', service: 'Blanqueamiento',         date: dateStr(3),  time: '11:15', status: 'pending'   },
  { id: 'a6', patientName: 'Ane Zubizarreta',  phone: '+34 633 880 145', service: 'Implante · consulta',    date: dateStr(4),  time: '17:30', status: 'confirmed' },
];

// upcoming (dashboard) uses same shape
const UPCOMING = APPOINTMENTS.slice(0, 4).map(function (a) {
  return { patientName: a.patientName, service: a.service, date: a.date, time: a.time, status: a.status };
});

const CALLS = [
  { callId: 'call-1', startedAt: iso(0, 9, 12),  duration: 138, outcome: 'booked', turnCount: 9,  contactId: 'c3', contactName: 'Aitor Sánchez',    callerNumber: '+34 622 908 114', appointments: [{ date: dateStr(0), time: '12:30', service: 'Limpieza dental' }] },
  { callId: 'call-2', startedAt: iso(0, 8, 40),  duration: 96,  outcome: 'info',   turnCount: 6,  contactId: 'c4', contactName: 'Nerea Goikoetxea', callerNumber: '+34 699 330 552', appointments: [] },
  { callId: 'call-3', startedAt: iso(-1, 18, 5), duration: 205, outcome: 'booked', turnCount: 12, contactId: 'c1', contactName: 'María Etxeberria', callerNumber: '+34 688 112 233', appointments: [{ date: dateStr(2), time: '16:00', service: 'Ortodoncia · revisión' }] },
  { callId: 'call-4', startedAt: iso(-1, 11, 30),duration: 42,  outcome: 'abandoned', turnCount: 1, contactId: null, contactName: null,             callerNumber: '+34 600 123 456', appointments: [] },
  { callId: 'call-5', startedAt: iso(-2, 16, 22),duration: 154, outcome: 'booked', turnCount: 8,  contactId: 'c6', contactName: 'Lucía Fernández',  callerNumber: '+34 677 221 908', appointments: [{ date: dateStr(3), time: '11:15', service: 'Blanqueamiento' }] },
  { callId: 'call-6', startedAt: iso(-3, 10, 8), duration: 118, outcome: 'info',   turnCount: 7,  contactId: 'c2', contactName: 'Jon Agirre',       callerNumber: '+34 655 447 781', appointments: [] },
];

const TRANSCRIPTS = {
  'call-1': {
    startedAt: iso(0, 9, 12), durationMs: 138000,
    transcript: [
      { role: 'assistant', content: 'Clínica Dental Bidasoa, buenos días, soy Ainara. ¿En qué puedo ayudarle?' },
      { role: 'user',      content: 'Hola, quería pedir cita para una limpieza dental.' },
      { role: 'assistant', content: 'Claro, con mucho gusto. ¿Le viene bien hoy a las 12:30?' },
      { role: 'user',      content: 'Sí, perfecto.' },
      { role: 'assistant', content: 'Estupendo. ¿Me puede dar su nombre, por favor?' },
      { role: 'user',      content: 'Aitor Sánchez.' },
      { role: 'assistant', content: 'Perfecto, Aitor. Le he reservado la limpieza dental hoy a las 12:30. Le esperamos. ¡Que tenga un buen día!' },
    ],
    analysis: {
      score: 92, satisfied: true, hallucinated: false,
      problems: [], improvements: ['Podría confirmar el teléfono de contacto para el recordatorio.'],
    },
  },
  'call-3': {
    startedAt: iso(-1, 18, 5), durationMs: 205000,
    transcript: [
      { role: 'assistant', content: 'Clínica Dental Bidasoa, buenas tardes. ¿En qué le ayudo?' },
      { role: 'user',      content: 'Buenas, soy María, tengo ortodoncia con ustedes y quería mi revisión mensual.' },
      { role: 'assistant', content: 'Por supuesto, María. Tengo hueco pasado mañana a las 16:00, ¿le encaja?' },
      { role: 'user',      content: 'Sí, me va bien.' },
      { role: 'assistant', content: 'Reservado. Revisión de ortodoncia el ' + dateStr(2) + ' a las 16:00. Le enviaremos un recordatorio. ¡Hasta pronto!' },
    ],
    analysis: {
      score: 88, satisfied: true, hallucinated: false,
      problems: [], improvements: [],
    },
  },
};
function fallbackTranscript(id) {
  return {
    startedAt: iso(0, 10, 0), durationMs: 90000,
    transcript: [
      { role: 'assistant', content: 'Clínica Dental Bidasoa, ¿en qué puedo ayudarle?' },
      { role: 'user',      content: 'Quería información sobre sus horarios.' },
      { role: 'assistant', content: 'Abrimos de lunes a viernes de 9:00 a 14:00 y de 16:00 a 20:00. ¿Desea que le reserve una cita?' },
      { role: 'user',      content: 'De momento no, gracias.' },
      { role: 'assistant', content: 'Sin problema. Quedo a su disposición. ¡Que vaya bien!' },
    ],
    analysis: { score: 90, satisfied: true, hallucinated: false, problems: [], improvements: [] },
  };
}

const DASHBOARD = {
  businessName: 'Clínica Dental Bidasoa',
  aiStatus: 'active',
  today: { callCount: 6, bookedToday: 3, emailsSent: 4, hoursSaved: 1.5 },
  valueEstToday: 240,
  avgTicketConfigured: true,
  totalCalls: 312,
  totalBookings: 148,
  daysActive: 47,
  nodeflowNumber: NF_NUMBER,
  onboarding: {
    number_assigned: true,
    complete: true,
    doneCount: 5, total: 5,
    steps: [
      { key: 'assistant',  done: true },
      { key: 'business',   done: true },
      { key: 'heard',      done: true },
      { key: 'forwarding', done: true },
    ],
  },
  upcoming: UPCOMING,
  recentActivity: [
    { type: 'reserva', text: 'Aitor Sánchez · Limpieza dental hoy 12:30',   time: iso(0, 9, 14) },
    { type: 'info',    text: 'Consulta de horarios resuelta',                time: iso(0, 8, 42) },
    { type: 'reserva', text: 'María Etxeberria · Ortodoncia ' + dateStr(2),  time: iso(-1, 18, 8) },
    { type: 'info',    text: 'Consulta de precios de blanqueamiento',        time: iso(-1, 12, 3) },
    { type: 'reserva', text: 'Lucía Fernández · Blanqueamiento ' + dateStr(3), time: iso(-2, 16, 26) },
  ],
};

const BRIEFING = {
  ok: true,
  greeting: 'Buenos días',
  greetingName: 'Clínica Dental Bidasoa',
  summary: 'Ayer tu asistente atendió 8 llamadas y reservó 3 citas mientras tú trabajabas.',
  allClear: false,
  lines: [
    { icon: '📞', text: '2 clientes llamaron y se quedaron sin cita — recupéralos', section: 'oportunidades' },
    { icon: '⚠️', text: '1 cita de mañana con riesgo de plantón — confírmala', section: 'citas' },
    { icon: '🧠', text: 'Tu asistente no supo responder 1 pregunta — enséñale', section: 'conocimiento' },
  ],
};

const TASKS = {
  suggested: [
    { key: 'sug-1', section: 'oportunidades', sourceId: 'op1', icon: '📞', text: 'Llama a Iker Muñoz: llamó y no reservó hace 2 días.' },
    { key: 'sug-2', section: 'conocimiento',  sourceId: 'kb1', icon: '🧠', text: 'Enseña a tu asistente si aceptáis Adeslas.' },
  ],
  manual: [
    { id: 1, title: 'Pedir presupuesto de nuevo sillón dental', done: false, due_date: dateStr(5) },
    { id: 2, title: 'Llamar al laboratorio por la férula de Ane', done: false, due_date: dateStr(1), contact_name: 'Ane Zubizarreta' },
    { id: 3, title: 'Revisar stock de anestesia', done: true, due_date: dateStr(-2) },
  ],
};

const INSIGHTS = {
  available: true,
  total: 128,
  convRate: 61,
  peakDayName: 'Lunes',
  peakHour: 10,
  byHour: [0,0,0,0,0,0,0,1,4,9,14,11,7,3,6,10,12,9,6,4,2,1,0,0],
  byDay: [3, 28, 22, 19, 24, 26, 6], // Sun..Sat
};

const MISSED_OPPS = {
  sinceDays: 7,
  opportunities: [
    { phone: '+34 611 774 006', count: 1, lastCall: iso(-2, 10, 0), lastCallId: 'call-4', name: 'Iker Muñoz' },
    { phone: '+34 600 123 456', count: 2, lastCall: iso(-1, 11, 30), lastCallId: 'call-4', name: '' },
  ],
};

const AT_RISK = {
  atRisk: [
    { phone: '+34 655 447 781', time: '09:30', patientName: 'Jon Agirre', service: 'Empaste', note: 'Ha faltado 2 veces', noShows: 2 },
  ],
};

// ── Follow-ups / campaigns ────────────────────────────────────────────────
const FOLLOWUP_RULES = {
  sector: 'dental',
  sectorLabel: 'Clínica dental',
  channels: ['whatsapp', 'email'],
  channelsLive: { whatsapp: true, sms: false, email: true },
  frequencyCapDays: 30,
  customTriggers: [
    { value: 'last_cleaning', label: 'Desde la última limpieza' },
    { value: 'last_visit',    label: 'Desde la última visita' },
  ],
  fieldCoverage: { last_cleaning: 210, last_visit: 260 },
  rules: [
    { key: 'reminder',   label: 'Recordatorio de cita',        desc: 'Aviso el día antes de cada cita.',            trigger: 'appointment', triggerLabel: 'Antes de la cita', days: 1,   channel: 'whatsapp', custom: false, enabled: true,  applies: true, editableDays: true },
    { key: 'recall',     label: 'Recuperación de clientes',    desc: 'Aviso a quien lleva tiempo sin venir.',       trigger: 'last_visit',  triggerLabel: 'Desde la última visita', days: 180, channel: 'whatsapp', custom: false, enabled: true,  applies: true, editableDays: true },
    { key: 'cleaning',   label: 'Limpieza semestral',          desc: 'Recordatorio de limpieza cada 6 meses.',      trigger: 'last_cleaning', triggerLabel: 'Desde la última limpieza', days: 180, channel: 'email', custom: false, enabled: true, applies: true, editableDays: true },
    { key: 'review',     label: 'Petición de reseña en Google', desc: 'Tras la visita, pide una reseña.',            trigger: 'appointment', triggerLabel: 'Tras la cita', days: 1,   channel: 'whatsapp', custom: false, enabled: false, applies: true, editableDays: true },
  ],
};

const RULE_RECIPES = {
  recipes: [
    { label: 'Felicitación de cumpleaños', days: 0,   tip: 'Un detalle que fideliza.', trigger: 'birthday' },
    { label: 'Revisión anual',            days: 365, tip: 'Trae de vuelta a quien vino hace un año.', trigger: 'last_visit' },
    { label: 'Aviso post-implante',       days: 15,  tip: 'Seguimiento tras un implante.', trigger: 'last_visit', serviceFilter: ['implante'] },
  ],
};

const RULE_REACH = { total: 342, horizon: 30 };

const RULE_SUGGESTIONS = {
  suggestions: [
    { id: 's1', title: 'Adelanta el recordatorio a 2 días', detail: 'Tus clientes confirman más cuando avisas con 48h.', type: 'timing', sampleSize: 84 },
    { id: 's2', title: 'Activa la petición de reseña', detail: 'Podrías conseguir ~12 reseñas nuevas al mes.', type: 'growth', sampleSize: 60 },
  ],
};

const FOLLOWUPS = {
  followups: [
    { callId: 'call-4', phone: '+34 600 123 456', name: '', reason: 'abandoned', when: iso(-1, 11, 30), draft: 'Hola, vimos que nos llamaste y se cortó. ¿Quieres que te ayudemos a reservar tu cita en la Clínica Dental Bidasoa?' },
    { callId: 'call-6', phone: '+34 655 447 781', name: 'Jon Agirre', reason: 'callback_requested', when: iso(-3, 10, 8), draft: 'Hola Jon, nos pediste que te llamáramos para tu empaste. ¿Te viene bien esta semana?' },
  ],
};

const FOLLOWUP_ROI = {
  totals: { count: 34, value: 2380, auto: 21, personal: 13 },
  sentCount: 51,
};

const RECOVERY = {
  total: 2380,
  lines: [
    { label: 'Llamadas rescatadas', count: 9,  value: 1260 },
    { label: 'Seguimientos que trajeron cita', count: 12, value: 1120 },
  ],
};

const CAMPAIGNS = {
  audience: 342,
  campaigns: [
    { key: 'verano',  name: 'Campaña de verano · blanqueamiento', day: 1, month: 6,  text: 'Este verano, luce tu mejor sonrisa. Blanqueamiento con 15% de descuento pidiendo cita antes del 30 de junio.', enabled: true,  lastFiredYear: '2025' },
    { key: 'navidad', name: 'Revisión de fin de año',            day: 1, month: 12, text: 'Cierra el año con una revisión y limpieza. Pide tu cita de diciembre.', enabled: true },
    { key: 'vuelta',  name: 'Vuelta al cole · revisión infantil', day: 1, month: 9,  text: 'Revisión dental infantil para la vuelta al cole. Reserva ya.', enabled: false },
  ],
};

const MSG_USAGE = { used: 142, included: 300, overage: 0, overageEur: 0, ratePerMessage: 0.05 };

// ── Config / assistant ────────────────────────────────────────────────────
const SCHEDULE = {
  mon: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
  tue: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
  wed: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
  thu: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
  fri: { open: '09:00', close: '14:00' },
  sat: { open: '10:00', close: '13:00' },
};

const ASSISTANT = {
  orgName: 'Clínica Dental Bidasoa',
  config: {
    assistantName: 'Ainara',
    language: 'es',
    mode: 'citas',
    firstMessage: 'Clínica Dental Bidasoa, buenos días. Soy Ainara, ¿en qué puedo ayudarle?',
    extraInfo: 'Somos una clínica dental familiar en Irun. Aceptamos Sanitas y Adeslas. Aparcamiento gratuito en la puerta.',
    voice: 'nf-femenina-1',
    sector: 'dental',
    sectorData: {},
    schedule: SCHEDULE,
  },
};

const CONFIG = {
  hasPassword: true,
  config: {
    name: 'Clínica Dental Bidasoa',
    ownerEmail: 'demo@nodeflow.es',
    phone: NF_NUMBER,
    language: 'es',
    sector: 'dental',
    avgTicket: 60,
    address: 'Calle Mayor 12, 20302 Irun (Gipuzkoa)',
    reviewUrl: 'https://g.page/r/clinica-dental-bidasoa/review',
    alertPhone: '+34 688 000 999',
    notifyEmail: 'demo@nodeflow.es',
    welcomeMessage: 'Clínica Dental Bidasoa, buenos días. ¿En qué puedo ayudarle?',
    serviceList: [
      { name: 'Limpieza dental',  price: '55',  duration: '30', details: 'Higiene profesional con ultrasonidos.' },
      { name: 'Revisión',         price: '30',  duration: '20', details: 'Revisión general y diagnóstico.' },
      { name: 'Empaste',          price: '65',  duration: '40', details: 'Obturación con composite.' },
      { name: 'Ortodoncia',       price: '90',  duration: '30', details: 'Ajuste mensual de ortodoncia.' },
      { name: 'Blanqueamiento',   price: '250', duration: '60', details: 'Blanqueamiento en clínica.' },
    ],
  },
};

const CONFIG_GAPS = {
  gaps: [
    { gap: '¿Trabajáis con Adeslas?', count: 4 },
    { gap: '¿Tenéis financiación para implantes?', count: 3 },
  ],
};

const KNOWLEDGE = {
  chunks: 3,
  text: 'La Clínica Dental Bidasoa está en Irun (Gipuzkoa), en la Calle Mayor 12. Abrimos de lunes a viernes de 9:00 a 14:00 y de 16:00 a 20:00, y sábados de 10:00 a 13:00. Ofrecemos limpieza dental, revisiones, empastes, ortodoncia, blanqueamiento e implantes. Aceptamos Sanitas y Adeslas y disponemos de financiación sin intereses para tratamientos de implantología. Hay aparcamiento gratuito frente a la clínica.',
};

const KB_UNANSWERED = {
  questions: [
    { question: '¿Aceptáis el seguro DKV?', count: 2 },
    { question: '¿Hacéis carillas dentales?', count: 1 },
  ],
};

const AUTOMATIONS = {
  automations: {
    reminders: { enabled: true, hoursBefore: 24 },
    reviews:   { enabled: true, hoursAfter: 2 },
    waConfirm: { enabled: true },
    rebooking: { enabled: true, daysThreshold: 180, channel: 'whatsapp' },
    noshow:    { enabled: true },
    entityCalls: { enabled: false },
    entitySummaryOnCreate: { enabled: false },
  },
};

const VOICES = {
  tiers: {
    estandar: { label: 'Estándar' },
    premium:  { label: 'Premium' },
  },
  voices: [
    { id: 'nf-femenina-1', name: 'Ainara', gender: 'female', accent: 'Español (neutro)', age: 'Adulta', description: 'Cálida y profesional, ideal para recepción.', labels: ['cálida', 'clara', 'profesional'], tier: 'estandar', isClone: false, useCase: 'Recepción', provider: 'elevenlabs', tier_label: 'Estándar', providerVoiceId: 'v-ain' },
    { id: 'nf-femenina-2', name: 'Maddi',  gender: 'female', accent: 'Español (norte)', age: 'Joven',   description: 'Cercana y enérgica.', labels: ['cercana', 'enérgica'], tier: 'estandar', isClone: false, useCase: 'Recepción', provider: 'elevenlabs', providerVoiceId: 'v-mad' },
    { id: 'nf-masculina-1', name: 'Iñaki', gender: 'male',   accent: 'Español (neutro)', age: 'Adulto', description: 'Serena y segura.', labels: ['serena', 'segura'], tier: 'estandar', isClone: false, useCase: 'Recepción', provider: 'elevenlabs', providerVoiceId: 'v-ina' },
    { id: 'nf-premium-1',  name: 'Elena',  gender: 'female', accent: 'Español (neutro)', age: 'Adulta', description: 'Voz premium ultra-realista.', labels: ['premium', 'natural'], tier: 'premium', isClone: false, useCase: 'Premium', provider: 'elevenlabs', providerVoiceId: 'v-ele' },
  ],
};

const SECTORS = {
  sectors: [
    { slug: 'dental',        label: 'Clínica dental' },
    { slug: 'clinicas',      label: 'Clínica / consulta' },
    { slug: 'fisioterapia',  label: 'Fisioterapia' },
    { slug: 'peluquerias',   label: 'Peluquería' },
    { slug: 'estetica',      label: 'Estética' },
    { slug: 'veterinarias',  label: 'Veterinaria' },
    { slug: 'talleres',      label: 'Taller' },
    { slug: 'abogados',      label: 'Abogados' },
    { slug: 'generico',      label: 'General' },
  ],
};

// ── Billing / usage ───────────────────────────────────────────────────────
const BILLING_USAGE = {
  plan: 'pro',
  minutesUsed: 186,
  minutesLimit: 500,
  minutesRemaining: 314,
  percentUsed: 37,
  overage: 0,
  overageCost: 0,
  overageRate: 0.10,
};

const BILLING_INVOICES = {
  invoices: [
    { id: 'in_003', date: unixDaysAgo(2),  currency: 'eur', amount: 99, number: 'NF-2026-003', status: 'paid', pdf: '#' },
    { id: 'in_002', date: unixDaysAgo(32), currency: 'eur', amount: 99, number: 'NF-2026-002', status: 'paid', pdf: '#' },
    { id: 'in_001', date: unixDaysAgo(62), currency: 'eur', amount: 99, number: 'NF-2026-001', status: 'paid', pdf: '#' },
  ],
};

const VOICE_QUOTA = { ok: true, metered: false, downgraded: false, used: 40, quota: 120, remaining: 80, hasAddon: true, extraMinutes: 0 };

const ADDONS = {
  addons: [
    { key: 'voz_premium', label: 'Voz Premium', blurb: 'Voces ultra-realistas para tu asistente.', monthlyCents: 1000, active: true,  available: true },
    { key: 'crecimiento', label: 'Crecimiento', blurb: 'Campañas de reactivación por voz y email.', monthlyCents: 3900, active: false, available: true },
  ],
};

const REFERRAL = {
  available: true,
  code: 'BIDASOA25',
  link: 'https://nodeflow.es/alta?ref=BIDASOA25',
  shareText: 'Uso NodeFlow para que mi clínica no pierda ni una llamada. Con mi código BIDASOA25 te llevas un 25% de descuento: https://nodeflow.es/alta?ref=BIDASOA25',
  refereeDiscount: 25,
  timesShared: 6,
  timesConverted: 2,
  rewardPending: 1,
};

const WIDGET = {
  snippet: '<script src="https://nodeflow.es/widget/nf.js" data-org="demo-org-0001" async></script>',
  callbacks: [
    { name: 'Paula Ruiz',   phone: '+34 622 118 447', message: '¿Podéis llamarme para una urgencia?', created_at: iso(-1, 19, 20) },
    { name: 'Mikel Otaegi', phone: '+34 688 552 013', message: 'Quiero presupuesto de ortodoncia invisible.', created_at: iso(-2, 12, 5) },
  ],
};

const WEBHOOKS = {
  webhooks: [
    { id: 'wh1', url: 'https://example.com/nodeflow-hook', enabled: true, events: ['*'] },
  ],
};

// ── Integrations ──────────────────────────────────────────────────────────
const CAL_STATUS     = { enabled: true, connected: true };
const OUTLOOK_STATUS = { enabled: false, connected: false };
const WA_STATUS      = { connected: true, phoneNumber: '+34 943 000 000', wabaId: 'waba-demo-001', sharedActive: true, hasAddon: true };
const WA_ES_CONFIG   = { available: true, appId: 'demo-app-id' };

// ── Reports ───────────────────────────────────────────────────────────────
function kpi(value, spark, dir, pct) {
  return { value: value, spark: spark, delta: { pct: pct == null ? null : pct, dir: dir || 'flat' } };
}
function buildReports(range) {
  const labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
  return {
    hasData: true,
    lowData: false,
    rangeLabel: 'Últimos 30 días · ' + (range || 'month'),
    kpis: {
      totalCalls: kpi(128, [22, 28, 30, 26, 34, 38, 42], 'up', 12),
      bookings:   kpi(78,  [12, 15, 16, 14, 19, 21, 24], 'up', 9),
      convRate:   kpi(61,  [55, 58, 60, 59, 62, 63, 61], 'up', 3),
      hoursSaved: kpi(34,  [4, 5, 5, 4, 6, 6, 7],       'up', 8),
      revenueEst: kpi(4680,[600,720,760,700,860,920,980],'up', 14),
    },
    insights: {
      trend:   'Tus llamadas crecen semana a semana — buena señal de campaña.',
      funnel:  'De cada 10 llamadas, 6 acaban en cita. Muy por encima de la media.',
      money:   'La mayoría de tus ingresos vienen de citas reservadas por voz.',
      weekday: 'Los lunes concentran el 22% de tus llamadas.',
      hours:   'Tu hora punta es a las 10:00. Refuerza recepción a esa hora.',
      services:'La limpieza dental es tu servicio más solicitado.',
    },
    trend:   { labels: labels, calls: [96, 110, 118, 128], bookings: [58, 66, 72, 78] },
    funnel:  { steps: [
      { label: 'Llamadas atendidas', value: 128, pct: 100, dropPct: 0 },
      { label: 'Conversaciones',     value: 104, pct: 81,  dropPct: 19 },
      { label: 'Citas reservadas',   value: 78,  pct: 61,  dropPct: 20 },
      { label: 'Citas confirmadas',  value: 71,  pct: 55,  dropPct: 6 },
    ] },
    money: {
      total: 4680,
      recovered: 1120,
      segments: [
        { key: 'voz',          label: 'Reservas por voz',       value: 3200, estimated: false },
        { key: 'seguimientos', label: 'Seguimientos',           value: 1120, estimated: true  },
        { key: 'fichas',       label: 'Fichas / recordatorios', value: 360,  estimated: true  },
      ],
    },
    weekday: [
      { label: 'Lun', value: 28 }, { label: 'Mar', value: 22 }, { label: 'Mié', value: 19 },
      { label: 'Jue', value: 24 }, { label: 'Vie', value: 26 }, { label: 'Sáb', value: 6 }, { label: 'Dom', value: 3 },
    ],
    hours: (function () {
      const base = [0,0,0,0,0,0,0,1,4,9,14,11,7,3,6,10,12,9,6,4,2,1,0,0];
      return base.map(function (v, h) { return { hour: h, value: v }; });
    })(),
    services: [
      { name: 'Limpieza dental', count: 42 },
      { name: 'Revisión',        count: 31 },
      { name: 'Empaste',         count: 24 },
      { name: 'Ortodoncia',      count: 18 },
      { name: 'Blanqueamiento',  count: 11 },
    ],
    allTime: { totalCalls: 312, bookings: 148, hoursSaved: 96, revenueEst: 11840 },
  };
}

// ── Reminders ─────────────────────────────────────────────────────────────
const REMINDERS_UPCOMING = {
  reminders: [
    { id: 'r1', scheduled_for: iso(1, 10, 0),  contacts: { name: 'María Etxeberria' }, service_key: 'recordatorio_cita', channel: 'whatsapp' },
    { id: 'r2', scheduled_for: iso(1, 10, 0),  contacts: { name: 'Aitor Sánchez' },    service_key: 'recordatorio_cita', channel: 'whatsapp' },
    { id: 'r3', scheduled_for: iso(2, 9, 0),   contacts: { name: 'Nerea Goikoetxea' }, service_key: 'revision',          channel: 'email' },
    { id: 'r4', scheduled_for: iso(6, 9, 0),   contacts: { name: 'Iker Muñoz' },       service_key: 'recuperacion',      channel: 'whatsapp' },
  ],
};

const REMINDERS_HISTORY = {
  reminders: [
    { status: 'sent',      sent_at: iso(-1, 10, 2),  updated_at: iso(-1, 10, 2),  contacts: { name: 'Lucía Fernández' }, service_key: 'recordatorio_cita', channel: 'whatsapp' },
    { status: 'sent',      sent_at: iso(-2, 9, 30),  updated_at: iso(-2, 9, 30),  contacts: { name: 'Jon Agirre' },      service_key: 'revision',          channel: 'email' },
    { status: 'failed',    updated_at: iso(-3, 11, 0), contacts: { name: 'Unax Bilbao' },     service_key: 'recuperacion',      channel: 'whatsapp', failed_reason: 'Número no válido' },
    { status: 'cancelled', updated_at: iso(-4, 8, 0),  contacts: { name: 'Ane Zubizarreta' }, service_key: 'recordatorio_cita', channel: 'whatsapp' },
  ],
};

// ── Sector completion (wizard) — keep it non-intrusive ────────────────────
const SECTOR_COMPLETION = { wizardNeeded: false, pendingCount: 0, contacts: [], fields: [], sector: 'dental' };

// ── Entities (dental has no entity tab by default → hide) ─────────────────
const ENTITY_TYPES = { available: false, types: [] };

// ════════════════════════════════════════════════════════════════════════
//  ROUTE MAP (exact-path GET endpoints)
// ════════════════════════════════════════════════════════════════════════
const GET_ROUTES = {
  '/api/portal/me': ME,
  '/api/portal/dashboard': DASHBOARD,
  '/api/portal/briefing': BRIEFING,
  '/api/portal/tasks': TASKS,
  '/api/portal/insights': INSIGHTS,
  '/api/portal/appointments': { appointments: APPOINTMENTS },
  '/api/portal/contacts/sector-completion': SECTOR_COMPLETION,
  '/api/portal/assistant': ASSISTANT,
  '/api/portal/config': CONFIG,
  '/api/portal/config/gaps': CONFIG_GAPS,
  '/api/portal/knowledge': KNOWLEDGE,
  '/api/portal/knowledge/unanswered': KB_UNANSWERED,
  '/api/portal/followup-rules': FOLLOWUP_RULES,
  '/api/portal/followup-rules/recipes': RULE_RECIPES,
  '/api/portal/followup-rules/reach': RULE_REACH,
  '/api/portal/followup-rules/suggestions': RULE_SUGGESTIONS,
  '/api/portal/followups': FOLLOWUPS,
  '/api/portal/followup-roi': FOLLOWUP_ROI,
  '/api/portal/recovery': RECOVERY,
  '/api/portal/missed-opportunities': MISSED_OPPS,
  '/api/portal/at-risk-tomorrow': AT_RISK,
  '/api/portal/waitlist': { waitlist: [] },
  '/api/portal/campaigns': CAMPAIGNS,
  '/api/portal/message-usage': MSG_USAGE,
  '/api/portal/reminders/upcoming': REMINDERS_UPCOMING,
  '/api/portal/referral': REFERRAL,
  '/api/portal/addons': ADDONS,
  '/api/portal/automations': AUTOMATIONS,
  '/api/portal/voice-quota': VOICE_QUOTA,
  '/api/portal/widget': WIDGET,
  '/api/portal/webhooks': WEBHOOKS,
  '/api/portal/whatsapp/status': WA_STATUS,
  '/api/portal/whatsapp/es-config': WA_ES_CONFIG,
  '/api/portal/entity-types': ENTITY_TYPES,
  '/api/billing/usage': BILLING_USAGE,
  '/api/billing/invoices': BILLING_INVOICES,
  '/api/calendar/status': CAL_STATUS,
  '/api/calendar/events': { events: [] },
  '/api/outlook/status': OUTLOOK_STATUS,
  '/api/voices': VOICES,
  '/api/sectors': SECTORS,
  '/health': { ok: true, bootId: 'demo-boot' },
};

// ════════════════════════════════════════════════════════════════════════
//  STATIC FILE SERVING
// ════════════════════════════════════════════════════════════════════════
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.webmanifest': 'application/manifest+json',
  '.txt':  'text/plain; charset=utf-8',
  '.pdf':  'application/pdf',
};

function sendJSON(res, obj, status) {
  const body = JSON.stringify(obj == null ? {} : obj);
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  // Map /portal and /portal/ to index.html
  let rel = decodeURIComponent(pathname);
  if (rel === '/portal' || rel === '/portal/') rel = '/portal/index.html';
  if (rel === '/')        rel = '/index.html';
  // Prevent path traversal
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    res.writeHead(403); res.end('Forbidden'); return 403;
  }
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { return null; }
  if (stat.isDirectory()) {
    const idx = path.join(filePath, 'index.html');
    try { fs.statSync(idx); } catch (e) { return null; }
    return streamFile(res, idx);
  }
  return streamFile(res, filePath);
}

function streamFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
    return 200;
  } catch (e) {
    res.writeHead(500); res.end('Read error'); return 500;
  }
}

// ════════════════════════════════════════════════════════════════════════
//  REQUEST HANDLER
// ════════════════════════════════════════════════════════════════════════
const server = http.createServer(function (req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;
  let status = 200;

  // Log after we determine status; wrap end to capture.
  function finish(st) {
    status = st;
    console.log(method + ' ' + req.url + ' -> ' + status);
  }

  // ── Health (portal's autoRefreshOnDeploy fetches /health, not /api/health) ─
  if (pathname === '/health') {
    sendJSON(res, { ok: true, bootId: 'demo-boot' });
    return finish(200);
  }

  // ── API routes ────────────────────────────────────────────────────────
  if (pathname === '/api' || pathname.indexOf('/api/') === 0) {
    // Auth endpoints
    if (pathname === '/api/auth/verify' || pathname === '/api/auth/login') {
      sendJSON(res, { session_token: 'demo-session', needs_password: false });
      return finish(200);
    }
    if (pathname === '/api/auth/set-password' ||
        pathname === '/api/portal/password/clear' ||
        pathname === '/api/auth/request-link') {
      sendJSON(res, { ok: true });
      return finish(200);
    }

    // Call transcript: /api/portal/calls/<id>/transcript
    let m = pathname.match(/^\/api\/portal\/calls\/([^\/]+)\/transcript$/);
    if (m && method === 'GET') {
      const id = decodeURIComponent(m[1]);
      sendJSON(res, TRANSCRIPTS[id] || fallbackTranscript(id));
      return finish(200);
    }

    // Calls list: /api/portal/calls (supports ?outcome=&from=&to=&limit=)
    if (pathname === '/api/portal/calls' && method === 'GET') {
      const q = parsed.query || {};
      let list = CALLS.slice();
      if (q.outcome && q.outcome !== 'todas') {
        list = list.filter(function (c) { return c.outcome === q.outcome; });
      }
      if (q.limit) list = list.slice(0, parseInt(q.limit, 10) || list.length);
      sendJSON(res, { calls: list, count: list.length });
      return finish(200);
    }

    // Contacts: /api/portal/contacts (supports ?q=&tag=)
    if (pathname === '/api/portal/contacts' && method === 'GET') {
      const q = parsed.query || {};
      let list = CONTACTS.slice();
      if (q.q) {
        const needle = String(q.q).toLowerCase();
        list = list.filter(function (c) {
          return (c.displayName || '').toLowerCase().indexOf(needle) >= 0 ||
                 (c.phone || '').indexOf(needle) >= 0 ||
                 (c.email || '').toLowerCase().indexOf(needle) >= 0;
        });
      }
      if (q.tag) list = list.filter(function (c) { return (c.tags || []).indexOf(q.tag) >= 0; });
      sendJSON(res, { contacts: list, allTags: ALL_TAGS, count: list.length });
      return finish(200);
    }

    // Reports: /api/portal/reports (?range= or ?period=)
    if (pathname === '/api/portal/reports' && method === 'GET') {
      const q = parsed.query || {};
      sendJSON(res, buildReports(q.range || q.period || 'month'));
      return finish(200);
    }

    // Reminders history: /api/portal/reminders (?status=&limit=)
    if (pathname === '/api/portal/reminders' && method === 'GET') {
      sendJSON(res, REMINDERS_HISTORY);
      return finish(200);
    }

    // Voice pack: /api/portal/voice-pack/<id>
    if (/^\/api\/portal\/voice-pack\//.test(pathname) && method === 'GET') {
      sendJSON(res, { ok: true, voices: VOICES.voices });
      return finish(200);
    }

    // Entities: /api/portal/entities?type=...
    if (pathname === '/api/portal/entities' && method === 'GET') {
      sendJSON(res, { entities: [] });
      return finish(200);
    }

    // Critical dates: /api/critical-dates/<orgId>
    if (/^\/api\/critical-dates\//.test(pathname) && method === 'GET') {
      sendJSON(res, { dates: [] });
      return finish(200);
    }

    // Exact-match GET routes
    if (method === 'GET' && Object.prototype.hasOwnProperty.call(GET_ROUTES, pathname)) {
      sendJSON(res, GET_ROUTES[pathname]);
      return finish(200);
    }

    // Any other GET → empty object (nothing throws)
    if (method === 'GET') {
      sendJSON(res, {});
      return finish(200);
    }

    // Any write method → { ok: true }
    sendJSON(res, { ok: true });
    return finish(200);
  }

  // ── Static files ────────────────────────────────────────────────────────
  const result = serveStatic(req, res, pathname);
  if (result == null) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return finish(404);
  }
  return finish(result);
});

server.listen(PORT, function () {
  console.log('NodeFlow portal MOCK server running:');
  console.log('  Portal:  http://localhost:' + PORT + '/portal');
  console.log('  Static:  ' + PUBLIC_DIR);
  console.log('  (any email + any/empty password logs in — demo session)');
});
