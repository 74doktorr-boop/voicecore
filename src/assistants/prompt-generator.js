// src/assistants/prompt-generator.js
// Compiles a system prompt from structured assistant config + sector template.
// Called by routes-assistant.js (on save) and routes-demo.js (on each demo chat).
'use strict';

const DAY_NAMES = { mon:'lunes', tue:'martes', wed:'miércoles', thu:'jueves', fri:'viernes', sat:'sábado', sun:'domingo' };

function formatSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return 'Consultar horario';
  const lines = [];
  for (const [day, slot] of Object.entries(schedule)) {
    if (!slot) {
      lines.push(`${DAY_NAMES[day] || day}: cerrado`);
    } else {
      lines.push(`${DAY_NAMES[day] || day}: ${slot.open}–${slot.close}`);
    }
  }
  return lines.join(', ');
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
${services ? `SERVICIOS: ${services}` : ''}
${sectorStr}
${extraInfo ? `INFORMACIÓN ADICIONAL: ${extraInfo}` : ''}

PROHIBIDO:
- No hables en otro idioma.
- No repitas preguntas ya respondidas.
- No hagas preguntas innecesarias de clarificación.
- No uses emojis.`.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { generatePrompt };
