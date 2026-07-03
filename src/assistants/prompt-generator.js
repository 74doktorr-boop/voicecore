// src/assistants/prompt-generator.js
// Compiles a system prompt from structured assistant config + sector template.
// Called by routes-assistant.js (on save) and routes-demo.js (on each demo chat).
'use strict';

const { buildCallContext } = require('../lifecycle/call-memory');

const DAY_NAMES = { mon:'lunes', tue:'martes', wed:'miércoles', thu:'jueves', fri:'viernes', sat:'sábado', sun:'domingo' };

function formatSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return 'Consultar horario';
  const lines = [];
  for (const [day, slot] of Object.entries(schedule)) {
    if (!slot) {
      lines.push(`${DAY_NAMES[day] || day}: cerrado`);
    } else if (slot.afternoon_open && slot.afternoon_close) {
      lines.push(`${DAY_NAMES[day] || day}: ${slot.open}–${slot.close} y ${slot.afternoon_open}–${slot.afternoon_close}`);
    } else {
      lines.push(`${DAY_NAMES[day] || day}: ${slot.open}–${slot.close}`);
    }
  }
  return lines.join(', ');
}

function formatServiceList(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const lines = list.filter(s => s && s.name).map(s => {
    let l = `- ${s.name}`;
    if (s.price)    l += `: ${s.price}`;
    if (s.duration) l += ` (${s.duration})`;
    if (s.notes)    l += ` — ${s.notes}`;
    return l;
  });
  if (!lines.length) return '';
  return `SERVICIOS Y PRECIOS (datos EXACTOS — úsalos al informar de precios, duración o servicios; no inventes):\n${lines.join('\n')}`;
}

function formatLanguage(lang) {
  if (lang === 'es+eu') return 'Responde en el idioma en que te hablen: español o euskera. Si no estás segura del idioma, usa español.';
  if (lang === 'eu')    return 'Responde exclusivamente en euskera.';
  return 'Responde exclusivamente en español de España.';
}

function sectorBlock(sector, sectorData = {}) {
  switch (sector) {
    case 'restaurante': {
      const carta = Array.isArray(sectorData.cartaItems) && sectorData.cartaItems.length > 0
        ? sectorData.cartaItems.map(i => `- ${i.name}${i.price ? ` (${i.price})` : ''}`).join('\n')
        : null;
      return [
        sectorData.horarioComida  ? `COMIDAS: ${sectorData.horarioComida}` : null,
        sectorData.horarioCena    ? `CENAS: ${sectorData.horarioCena}` : null,
        sectorData.maxGuests      ? `AFORO MÁXIMO POR RESERVA: ${sectorData.maxGuests} personas` : null,
        carta                     ? `CARTA:\n${carta}` : null,
      ].filter(Boolean).join('\n');
    }
    case 'fisioterapia':
    case 'dental':
    case 'clinica': {
      const seguros = Array.isArray(sectorData.seguros) && sectorData.seguros.length > 0
        ? `SEGUROS ACEPTADOS: ${sectorData.seguros.join(', ')}`
        : null;
      const espec = sectorData.especialidades
        ? `ESPECIALIDADES: ${sectorData.especialidades}`
        : null;
      return [seguros, espec].filter(Boolean).join('\n');
    }
    case 'peluqueria': {
      return sectorData.servicios
        ? `SERVICIOS Y PRECIOS:\n${sectorData.servicios}`
        : '';
    }
    case 'gimnasio': {
      return sectorData.clases
        ? `CLASES DISPONIBLES: ${sectorData.clases}`
        : '';
    }
    case 'optica': {
      const seguros = Array.isArray(sectorData.seguros) && sectorData.seguros.length > 0
        ? `SEGUROS ÓPTICOS: ${sectorData.seguros.join(', ')}` : null;
      const marcas = sectorData.marcas ? `MARCAS DISPONIBLES: ${sectorData.marcas}` : null;
      return [seguros, marcas].filter(Boolean).join('\n');
    }
    case 'psicologia':
    case 'coaching': {
      const esp      = sectorData.especialidades ? `ESPECIALIDADES: ${sectorData.especialidades}` : null;
      const sesiones = sectorData.duracionSesion ? `DURACIÓN DE SESIÓN: ${sectorData.duracionSesion}` : null;
      return [esp, sesiones].filter(Boolean).join('\n');
    }
    case 'nutricion':
    case 'dietetica': {
      const programas = sectorData.programas ? `PROGRAMAS: ${sectorData.programas}` : null;
      const metodo    = sectorData.metodo ? `METODOLOGÍA: ${sectorData.metodo}` : null;
      return [programas, metodo].filter(Boolean).join('\n');
    }
    case 'podologia': {
      return sectorData.servicios ? `SERVICIOS Y PRECIOS:\n${sectorData.servicios}` : '';
    }
    case 'autoescuela': {
      const carnets = sectorData.carnets ? `CARNETS: ${sectorData.carnets}` : null;
      const precio  = sectorData.precioPractica ? `PRECIO CLASE PRÁCTICA: ${sectorData.precioPractica}` : null;
      return [carnets, precio].filter(Boolean).join('\n');
    }
    case 'spa':
    case 'estetica_avanzada':
    case 'laser': {
      return sectorData.tratamientos ? `TRATAMIENTOS: ${sectorData.tratamientos}` : '';
    }
    case 'yoga':
    case 'pilates': {
      const tipos = sectorData.tiposClase ? `TIPOS DE CLASE: ${sectorData.tiposClase}` : null;
      const packs = sectorData.packs ? `PACKS DISPONIBLES: ${sectorData.packs}` : null;
      return [tipos, packs].filter(Boolean).join('\n');
    }
    case 'guarderia_canina':
    case 'residencia_mascotas': {
      const razas  = sectorData.razasAdmitidas ? `RAZAS ADMITIDAS: ${sectorData.razasAdmitidas}` : null;
      const plazas = sectorData.plazas ? `PLAZAS DISPONIBLES: ${sectorData.plazas}` : null;
      return [razas, plazas].filter(Boolean).join('\n');
    }
    case 'abogado':
    case 'abogados':
    case 'notaria': {
      const esp      = sectorData.especialidades ? `ESPECIALIDADES LEGALES: ${sectorData.especialidades}` : null;
      const consulta = sectorData.consultaInicial ? `CONSULTA INICIAL: ${sectorData.consultaInicial}` : null;
      return [esp, consulta].filter(Boolean).join('\n');
    }
    case 'agencia_viajes': {
      return sectorData.destinos ? `DESTINOS PRINCIPALES: ${sectorData.destinos}` : '';
    }
    case 'reformas':
    case 'arquitectura': {
      return sectorData.tiposObra ? `TIPOS DE OBRA/REFORMA: ${sectorData.tiposObra}` : '';
    }
    case 'veterinaria': {
      const esp       = sectorData.especialidades ? `ESPECIALIDADES: ${sectorData.especialidades}` : null;
      const urgencias = sectorData.urgencias24h   ? `URGENCIAS 24H: Sí — contactar con el veterinario de guardia` : null;
      const vacunas   = sectorData.vacunas        ? `CAMPAÑAS DE VACUNACIÓN: ${sectorData.vacunas}` : null;
      return [esp, urgencias, vacunas].filter(Boolean).join('\n');
    }
    case 'farmacia': {
      const servicios = sectorData.servicios ? `SERVICIOS ADICIONALES: ${sectorData.servicios}` : null;
      const seguros   = Array.isArray(sectorData.seguros) && sectorData.seguros.length > 0
        ? `MUTUAS/SEGUROS: ${sectorData.seguros.join(', ')}` : null;
      return [servicios, seguros].filter(Boolean).join('\n');
    }
    case 'hotel': {
      const tipo     = sectorData.tipo       ? `TIPO DE ALOJAMIENTO: ${sectorData.tipo}` : null;
      const servicios = sectorData.servicios ? `SERVICIOS: ${sectorData.servicios}` : null;
      const checkIn  = sectorData.checkIn    ? `CHECK-IN: ${sectorData.checkIn}` : null;
      const checkOut = sectorData.checkOut   ? `CHECK-OUT: ${sectorData.checkOut}` : null;
      return [tipo, servicios, checkIn, checkOut].filter(Boolean).join('\n');
    }
    case 'taller': {
      const marcas   = sectorData.marcas   ? `MARCAS QUE TRABAJA: ${sectorData.marcas}` : null;
      const servicios = sectorData.servicios ? `SERVICIOS: ${sectorData.servicios}` : null;
      const cita     = sectorData.citaPrevia !== undefined
        ? `CITA PREVIA: ${sectorData.citaPrevia ? 'Necesaria' : 'No necesaria'}` : null;
      return [marcas, servicios, cita].filter(Boolean).join('\n');
    }
    case 'academia': {
      const cursos  = sectorData.cursos  ? `CURSOS/CLASES: ${sectorData.cursos}` : null;
      const niveles = sectorData.niveles ? `NIVELES: ${sectorData.niveles}` : null;
      const precio  = sectorData.precio  ? `PRECIO CLASE: ${sectorData.precio}` : null;
      return [cursos, niveles, precio].filter(Boolean).join('\n');
    }
    case 'asesoria': {
      const esp      = sectorData.especialidades ? `ESPECIALIDADES: ${sectorData.especialidades}` : null;
      const software = sectorData.software ? `SOFTWARE CONTABLE: ${sectorData.software}` : null;
      const online   = sectorData.servicioOnline ? `SERVICIO ONLINE: Disponible` : null;
      return [esp, software, online].filter(Boolean).join('\n');
    }
    case 'inmobiliaria': {
      const zona   = sectorData.zona   ? `ZONA DE ACTUACIÓN: ${sectorData.zona}` : null;
      const tipos  = sectorData.tipos  ? `TIPOS DE INMUEBLE: ${sectorData.tipos}` : null;
      const alquiler = sectorData.alquiler !== undefined
        ? `ALQUILER: ${sectorData.alquiler ? 'Sí' : 'Solo venta'}` : null;
      return [zona, tipos, alquiler].filter(Boolean).join('\n');
    }
    default:
      return '';
  }
}

/**
 * Generate a system prompt from structured assistant config.
 * @param {object} config   - The assistant_config object from the DB
 * @param {string} orgName  - The organization name (from organizations.name)
 * @returns {string}        - The compiled system prompt
 */
function generatePrompt(config, orgName) {
  // If admin set a raw override, use it verbatim
  if (config.customPromptOverride) return config.customPromptOverride;

  const assistantName = config.assistantName || 'Laura';
  const sector        = config.sector || 'generico';
  const language      = config.language || 'es';
  const scheduleStr   = formatSchedule(config.schedule);
  const services      = config.services || '';
  const serviceListStr = formatServiceList(config.serviceList);
  const extraInfo     = config.extraInfo || '';
  const langInstr     = formatLanguage(language);
  const sectorStr     = sectorBlock(sector, config.sectorData || {});

  return `Eres ${assistantName}, la recepcionista de ${orgName}.
Hablas por teléfono con clientes.

IDIOMA: ${langInstr}
FECHA DE HOY: {{DATE}}

ESTILO:
- Habla como una persona real por teléfono. Frases cortas y naturales.
- Máximo 1-2 frases por respuesta.
- Tono amable y profesional.
- Usa usted hasta que el cliente sea informal contigo.

CÓMO GESTIONAR LA CONVERSACIÓN:
- Pregunta UNA sola cosa cada vez.
- Si el cliente te da información que no pediste, recógela. No la ignores.
- NUNCA pidas algo que ya te hayan dicho.

HORARIO: ${scheduleStr}
${serviceListStr || (services ? `SERVICIOS: ${services}` : '')}
${sectorStr}
${extraInfo ? `INFORMACIÓN ADICIONAL: ${extraInfo}` : ''}

DATOS DEL CLIENTE (perfilado progresivo, con naturalidad):
- En toda reserva pide SIEMPRE el nombre. Para el teléfono, como llama desde uno, confirma: «¿Le aviso a este número desde el que me llama?».
- Un dato por vez, integrado en la conversación — jamás un interrogatorio.
- Si el historial ya trae su nombre, salúdale por él y no lo vuelvas a pedir.
- Si menciona email, preferencias o datos útiles (alergias, vehículo, mascota), recuérdalos el resto de la llamada sin pedirlos dos veces.

${config.mode === 'contacto' ? `TU MISIÓN (negocio sin agenda de citas):
- Informas sobre el negocio y sus servicios, y tomas los datos de quien quiera que le contacten. NO gestionas citas: si alguien pide cita u hora, explica que el equipo le llamará para concretar y registra el lead.` : `REGLA DE ORO DE CITAS (obligatoria, sin excepciones):
- NUNCA propongas ni confirmes un día u hora sin haber llamado a check_availability en ESTE turno.
- Ofrece EXCLUSIVAMENTE huecos que la herramienta haya devuelto.
- Si el cliente propone día/hora, verifícalo con la herramienta ANTES de aceptarlo.
- Si la herramienta dice que un día está cerrado, no insistas: ofrece los días de apertura que te indique.`}

INFORMACIÓN, PRESUPUESTOS Y "QUE ME LLAMEN" (obligatorio):
- TÚ NO PUEDES ENVIAR NADA: ni emails, ni WhatsApps, ni documentos. NUNCA prometas «le envío la información» — es mentira y destruye la confianza.
- Cuando alguien pida información, presupuesto o que le contacten: pide solo su NOMBRE y qué necesita, usa register_lead, y di que el equipo le llamará muy pronto A ESTE MISMO NÚMERO. Su teléfono ya lo tienes — no lo pidas.
- JAMÁS pidas un email por teléfono: dictar emails por voz es un suplicio para el cliente. Si el cliente insiste en email, registra el lead igualmente y di que el equipo se lo pedirá al contactarle.

DICCIÓN TELEFÓNICA (esto se LEE EN VOZ ALTA por teléfono):
- Di precios y horas SIEMPRE en palabras naturales: «quince euros», «a la una y media», «a las dos menos cuarto». Jamás símbolos (€) ni formatos como 13:00 o 15€.
- Frases cortas y naturales, una idea por frase. Es una conversación hablada, no un texto.
- Confirma los datos importantes repitiéndolos: «Perfecto, María, el jueves a las diez y media».

PROHIBIDO:
- No hables en otro idioma.
- No repitas preguntas ya respondidas.
- No hagas preguntas innecesarias de clarificación.
- No uses emojis.
- No uses listas, guiones ni formato de texto.`.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Build a memory context block to append to any assistant prompt.
 * Returns empty string for first-time callers (no history yet).
 * @param {string} contactId
 * @param {string} orgId
 * @returns {Promise<string>}
 */
async function buildMemoryBlock(contactId, orgId) {
  if (!contactId || !orgId) return '';
  let ctx;
  try { ctx = await buildCallContext(contactId, orgId); }
  catch (e) { return ''; } // Never break the call flow

  if (!ctx || ctx.isFirstCall) return '';

  const lines = [
    '\n\n## Historial del cliente (usa esto para personalizar la conversación)',
    `- Número de llamadas anteriores: ${ctx.callCount}`,
  ];

  if (ctx.contactName) {
    lines.push(`- Se llama ${ctx.contactName}: salúdale por su nombre y NO vuelvas a pedírselo.`);
  }
  if (ctx.lastCallAt) {
    lines.push(`- Última llamada: ${new Date(ctx.lastCallAt).toLocaleDateString('es-ES')}`);
  }
  if (ctx.lastCallSummary) {
    lines.push(`- Resumen última llamada: ${String(ctx.lastCallSummary).slice(0, 300)}`);
  }
  if (ctx.preferences?.horario) {
    lines.push(`- Prefiere horario: ${ctx.preferences.horario}`);
  }
  if (ctx.preferences?.idioma) {
    lines.push(`- Idioma preferido: ${ctx.preferences.idioma}`);
  }
  if (ctx.recentCalls?.length > 1) {
    const prev = ctx.recentCalls.slice(1).map(c =>
      `  * ${c.created_at ? new Date(c.created_at).toLocaleDateString('es-ES') : 'fecha desconocida'}: ${c.summary?.slice(0, 200) || ''}`
    ).join('\n');
    lines.push(`- Llamadas previas:\n${prev}`);
  }

  return lines.join('\n');
}

module.exports = { generatePrompt, buildMemoryBlock, formatServiceList };
