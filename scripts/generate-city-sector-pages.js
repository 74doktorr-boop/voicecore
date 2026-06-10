#!/usr/bin/env node
/**
 * generate-city-sector-pages.js
 * Generates sector+city landing pages for NodeFlow SEO.
 * Output: public/{sector}/{ciudad}/index.html (24 pages)
 */

const fs = require('fs');
const path = require('path');

const cities = {
  bilbao: {
    name: 'Bilbao',
    nameEs: 'Bilbao',
    province: 'Bizkaia',
    region: 'ES-BI',
    lat: 43.2627,
    lon: -2.9253,
    postalCode: '48001',
    hreflang: true,
    demonym: 'bilbaíno',
    neighborhoods: 'Casco Viejo, Abando, Indautxu',
    area: 'Gran Bilbao',
    euskeraNote: 'En Bilbao, cada vez más clientes prefieren ser atendidos en euskera.',
    nearbyTowns: 'Barakaldo, Getxo, Basauri, Leioa',
  },
  donostia: {
    name: 'Donostia-San Sebastián',
    nameEs: 'Donostia',
    province: 'Gipuzkoa',
    region: 'ES-SS',
    lat: 43.3183,
    lon: -1.9812,
    postalCode: '20001',
    hreflang: true,
    demonym: 'donostiarra',
    neighborhoods: 'Parte Vieja, Centro, Gros, Amara',
    area: 'Donostia-San Sebastián',
    euskeraNote: 'En Gipuzkoa, el euskera es el idioma habitual de muchos clientes.',
    nearbyTowns: 'Hernani, Andoain, Rentería, Irún',
  },
  vitoria: {
    name: 'Vitoria-Gasteiz',
    nameEs: 'Vitoria',
    province: 'Álava',
    region: 'ES-VI',
    lat: 42.8467,
    lon: -2.6726,
    postalCode: '01001',
    hreflang: true,
    demonym: 'vitoriano',
    neighborhoods: 'Casco Medieval, Ensanche, Salburua',
    area: 'Vitoria-Gasteiz',
    euskeraNote: 'En Vitoria-Gasteiz, la demanda de atención en euskera crece año a año.',
    nearbyTowns: 'Llodio, Salvatierra, Amurrio',
  },
};

const sectors = {
  peluquerias: {
    name: 'Peluquerías',
    nameSingular: 'peluquería',
    icon: '✂️',
    emoji: '✂️',
    sectorLabel: 'Peluquerías y salones de belleza',
    titleKeyword: 'Peluquerías con IA',
    heroLine1: 'Tu peluquería en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'una llamada',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu peluquería o salón de belleza en ${city.nameEs}, gestiona citas por estilista, responde preguntas sobre servicios y precios — y habla euskera nativo. Las 24 horas, los 365 días.`,
    problems: [
      {
        icon: '📵',
        title: 'Señal de ocupado en horas punta',
        text: (city) => `El sábado por la mañana es cuando más llaman en ${city.nameEs}. Y también cuando estás con las manos llenas de tinte y tijeras. Cada llamada que no coges es una cita que pierdes para siempre.`,
      },
      {
        icon: '🕗',
        title: 'Llamadas fuera de horario sin respuesta',
        text: (city) => `El cliente de ${city.nameEs} que trabaja hasta las 19h solo puede llamar por la noche. Si no hay nadie, busca en Instagram y reserva en otra peluquería que sí atienda.`,
      },
      {
        icon: '⏱️',
        title: 'Tiempo perdido entre clientes',
        text: () => `Cada llamada para confirmar o modificar una cita te interrumpe a mitad de un servicio. Atender el teléfono entre corte y corte consume entre 1 y 2 horas diarias de tu tiempo productivo.`,
      },
    ],
    benefits: [
      { icon: '✂️', title: 'Gestión por estilista', text: 'El asistente conoce la agenda de cada profesional. Si la clienta quiere con María, busca el próximo hueco libre de María.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos clientes prefieren hablar en euskera. NodeFlow detecta el idioma al instante. Voces de locutores vascos reales.` },
      { icon: '📅', title: 'Confirmaciones y recordatorios', text: 'El asistente envía recordatorios 24h antes. Las cancelaciones de última hora caen un 40% de media.' },
      { icon: '💰', title: 'Informa de precios sin malentendidos', text: 'El asistente informa de tarifas exactas (corte, color, mechas, tratamientos) antes de que reserven, eliminando sorpresas.' },
    ],
    faqs: (city) => [
      {
        q: `¿Puede el asistente gestionar citas para diferentes estilistas en ${city.nameEs}?`,
        a: `Sí. NodeFlow se configura con los horarios de cada profesional de tu peluquería en ${city.nameEs}. El asistente pregunta qué estilista prefiere el cliente y busca el hueco disponible en tiempo real según tu Google Calendar.`,
      },
      {
        q: `¿Funciona en euskera para clientes de ${city.nameEs}?`,
        a: `Sí. NodeFlow detecta automáticamente si el cliente habla en euskera o castellano y responde en el mismo idioma. Las voces son de locutores vascos reales. Perfecto para peluquerías en ${city.nameEs} y toda ${city.province}.`,
      },
      {
        q: `¿Cuánto cuesta el asistente IA para mi peluquería en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes, 1 asistente). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). Sin permanencias. Cancelas cuando quieras.`,
      },
      {
        q: `¿Tengo que cambiar el número de teléfono de mi peluquería en ${city.nameEs}?`,
        a: `No. NodeFlow se conecta a tu línea actual mediante desvío de llamada. Tus clientes siguen llamando al mismo número. Lo configuramos todo en pocos minutos.`,
      },
    ],
    stats: ['100% llamadas atendidas', '3h ahorro semanal', '24/7 disponibilidad', '0 llamadas perdidas'],
    ctaTitle: (city) => `Tu peluquería en ${city.nameEs} merece<br><span class="grad-text">un recepcionista que nunca falla</span>`,
  },
  dental: {
    name: 'Clínicas Dentales',
    nameSingular: 'clínica dental',
    icon: '🦷',
    emoji: '🦷',
    sectorLabel: 'Clínicas dentales y odontología',
    titleKeyword: 'Clínicas Dentales con IA',
    heroLine1: 'Tu clínica dental en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'un paciente',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu clínica dental en ${city.nameEs}, gestiona citas, responde sobre tratamientos y seguros — y habla euskera nativo. Las 24 horas, los 365 días.`,
    problems: [
      {
        icon: '📵',
        title: 'Recepción desbordada en horas punta',
        text: (city) => `Por la mañana en ${city.nameEs}, cuando más llaman los pacientes, tu recepcionista está atendiendo en mostrador. Cada llamada no atendida es una cita que se pierde.`,
      },
      {
        icon: '🕗',
        title: 'Urgencias fuera de horario sin respuesta',
        text: (city) => `Un paciente con dolor de muelas a las 21h en ${city.nameEs} llama a tu clínica. Si no hay respuesta, llama a la siguiente clínica de la lista. Pierdes ese paciente para siempre.`,
      },
      {
        icon: '📋',
        title: 'Gestión manual de recordatorios',
        text: () => `Sin recordatorios automáticos, el 20% de las citas resultan en no-shows. Cada hueco vacío en la agenda es dinero perdido y tiempo desperdiciado.`,
      },
    ],
    benefits: [
      { icon: '🦷', title: 'RGPD compliant', text: 'El asistente gestiona datos de pacientes cumpliendo la normativa de protección de datos sanitarios vigente en España.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos pacientes prefieren hablar en euskera. NodeFlow detecta el idioma al instante y responde con voz de locutor vasco nativo.` },
      { icon: '📅', title: 'Recordatorios de cita automáticos', text: 'Envía recordatorios por SMS 24h antes de cada cita. Reduce no-shows hasta un 40% y optimiza la agenda de la clínica.' },
      { icon: '💊', title: 'Informa sobre tratamientos y seguros', text: 'El asistente responde preguntas sobre implantes, ortodoncia, blanqueamiento, y qué seguros cubre la clínica antes de que el paciente reserve.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA puede gestionar citas para mi clínica dental en ${city.nameEs}?`,
        a: `Sí. NodeFlow gestiona citas de primera visita, revisiones, tratamientos y urgencias. El asistente consulta la disponibilidad real de tu agenda en Google Calendar y confirma la cita al instante.`,
      },
      {
        q: `¿Es RGPD compliant para clínicas dentales en España?`,
        a: `Sí. NodeFlow cumple con el RGPD y la normativa española de protección de datos. Los datos de los pacientes se tratan con las máximas garantías de seguridad y confidencialidad.`,
      },
      {
        q: `¿Funciona en euskera para pacientes de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del paciente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para una clínica dental en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', '-40% no-shows', '24/7 disponibilidad', 'RGPD compliant'],
    ctaTitle: (city) => `Tu clínica dental en ${city.nameEs} merece<br><span class="grad-text">cero llamadas perdidas</span>`,
  },
  estetica: {
    name: 'Centros de Estética',
    nameSingular: 'centro de estética',
    icon: '💅',
    emoji: '💅',
    sectorLabel: 'Estética, belleza y bienestar',
    titleKeyword: 'Estética con IA',
    heroLine1: 'Tu centro de estética en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'una reserva',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu centro de estética en ${city.nameEs}, gestiona citas, informa sobre tratamientos y precios — y habla euskera nativo. Las 24 horas.`,
    problems: [
      {
        icon: '📵',
        title: 'Interrupciones durante los tratamientos',
        text: (city) => `Cuando estás aplicando un tratamiento en ${city.nameEs}, no puedes coger el teléfono. El cliente que llama y no recibe respuesta llama al siguiente centro de estética.`,
      },
      {
        icon: '🕗',
        title: 'Consultas de precio fuera de horario',
        text: (city) => `Muchos clientes de ${city.nameEs} buscan información sobre tratamientos por la noche. Sin nadie que responda, pierdes la oportunidad de convertirlos en clientes.`,
      },
      {
        icon: '📋',
        title: 'Cancelaciones de última hora',
        text: () => `Sin recordatorios automáticos, un porcentaje significativo de citas resultan en no-shows, dejando huecos en tu agenda y pérdidas económicas.`,
      },
    ],
    benefits: [
      { icon: '💅', title: 'Informa sobre todos los tratamientos', text: 'El asistente responde sobre depilación láser, faciales, masajes, aparatología y cualquier servicio de tu centro con total precisión.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos clientes prefieren hablar en euskera. NodeFlow detecta el idioma y responde con voz natural de locutor vasco.` },
      { icon: '📅', title: 'Recordatorios automáticos', text: 'Envía recordatorios 24h antes. Reduce cancelaciones y no-shows para que tu agenda esté siempre optimizada.' },
      { icon: '🌙', title: 'Reservas mientras descansas', text: 'Los centros de estética con NodeFlow reciben el 25% de sus reservas fuera de horario laboral. Sin que tengas que hacer nada.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA puede gestionar citas para tratamientos específicos en ${city.nameEs}?`,
        a: `Sí. NodeFlow se configura con todos tus servicios y su duración. Si un cliente quiere un facial de 90 minutos, el asistente busca el hueco exacto en tu agenda y lo confirma.`,
      },
      {
        q: `¿Puede informar sobre precios de tratamientos de estética en ${city.nameEs}?`,
        a: `Absolutamente. Durante la configuración le proporcionas tu carta de servicios y tarifas. El asistente responde preguntas como "¿cuánto cuesta la depilación láser?" o "¿hacéis tratamientos corporales?" con precisión total.`,
      },
      {
        q: `¿Funciona en euskera para clientes de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del cliente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para un centro de estética en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', '-40% no-shows', '24/7 disponibilidad', '+25% reservas nocturnas'],
    ctaTitle: (city) => `Tu centro de estética en ${city.nameEs} merece<br><span class="grad-text">una agenda siempre llena</span>`,
  },
  veterinarias: {
    name: 'Clínicas Veterinarias',
    nameSingular: 'clínica veterinaria',
    icon: '🐾',
    emoji: '🐾',
    sectorLabel: 'Veterinarias y clínicas animales',
    titleKeyword: 'Veterinarias con IA',
    heroLine1: 'Tu veterinaria en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'una llamada urgente',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu clínica veterinaria en ${city.nameEs}, gestiona citas, responde sobre servicios y urgencias — y habla euskera nativo. Las 24 horas.`,
    problems: [
      {
        icon: '📵',
        title: 'Urgencias que no encuentran respuesta',
        text: (city) => `Un propietario en ${city.nameEs} llama a las 20h porque su perro ha ingerido algo tóxico. Si no hay respuesta, llama a la siguiente veterinaria. Esas llamadas urgentes nunca deben perderse.`,
      },
      {
        icon: '🕗',
        title: 'Consultas de precio y servicios fuera de horario',
        text: (city) => `Muchos dueños de mascotas en ${city.nameEs} buscan información sobre precios de vacunas o desparasitación por la noche. Sin respuesta, se van a la competencia.`,
      },
      {
        icon: '📋',
        title: 'Recordatorios de vacunas y revisiones',
        text: () => `Sin sistema de recordatorios, muchos pacientes no vuelven para las vacunas anuales o revisiones periódicas. Ingresos recurrentes que se pierden por falta de seguimiento.`,
      },
    ],
    benefits: [
      { icon: '🐾', title: 'Gestión de citas y urgencias', text: 'El asistente diferencia entre citas programadas y urgencias. Gestiona ambas con total eficiencia y te notifica de inmediato.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos clientes prefieren hablar en euskera. NodeFlow detecta el idioma y responde con voz natural de locutor vasco nativo.` },
      { icon: '📅', title: 'Recordatorios de vacunas y revisiones', text: 'Envía recordatorios automáticos para vacunas anuales, desparasitaciones y revisiones periódicas. Incrementa la fidelidad de tus clientes.' },
      { icon: '💊', title: 'Informa sobre servicios y precios', text: 'El asistente responde sobre precios de consulta, vacunas, cirugías, peluquería canina y cualquier servicio de tu clínica.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA puede gestionar urgencias veterinarias en ${city.nameEs}?`,
        a: `Sí. NodeFlow detecta cuando una llamada es una urgencia y la gestiona con prioridad. Puede informar sobre el protocolo de urgencias de tu clínica y, si es necesario, redirigir al servicio de urgencias más cercano.`,
      },
      {
        q: `¿Puede enviar recordatorios de vacunas a mis clientes en ${city.nameEs}?`,
        a: `Sí. NodeFlow puede configurarse para enviar recordatorios automáticos de vacunas anuales, desparasitaciones y revisiones periódicas por SMS o WhatsApp a tus clientes.`,
      },
      {
        q: `¿Funciona en euskera para clientes de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del cliente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para una clínica veterinaria en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', 'Urgencias 24/7', 'Recordatorios automáticos', '0 llamadas perdidas'],
    ctaTitle: (city) => `Tu veterinaria en ${city.nameEs} merece<br><span class="grad-text">atención las 24 horas</span>`,
  },
  fisioterapia: {
    name: 'Fisioterapia',
    nameSingular: 'clínica de fisioterapia',
    icon: '🏃',
    emoji: '🏃',
    sectorLabel: 'Fisioterapia y rehabilitación',
    titleKeyword: 'Fisioterapia con IA',
    heroLine1: 'Tu clínica de fisio en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'un paciente',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu clínica de fisioterapia en ${city.nameEs}, gestiona citas, responde sobre tratamientos y seguros — y habla euskera nativo. Las 24 horas.`,
    problems: [
      {
        icon: '📵',
        title: 'Interrupciones durante las sesiones',
        text: (city) => `Cuando estás tratando a un paciente en ${city.nameEs}, no puedes coger el teléfono. El paciente que llama y no recibe respuesta llama a otra clínica de fisioterapia.`,
      },
      {
        icon: '🕗',
        title: 'Consultas de seguros fuera de horario',
        text: (city) => `Muchos pacientes de ${city.nameEs} quieren saber si tu clínica trabaja con su seguro (Adeslas, Sanitas, Asisa) antes de reservar. Sin respuesta inmediata, se van.`,
      },
      {
        icon: '📋',
        title: 'Alta tasa de cancelaciones de última hora',
        text: () => `Sin recordatorios automáticos, las cancelaciones de última hora son frecuentes, dejando huecos en la agenda y pérdidas económicas significativas.`,
      },
    ],
    benefits: [
      { icon: '🏃', title: 'Gestión de citas y altas de paciente', text: 'El asistente gestiona primeras visitas, sesiones de seguimiento y altas de pacientes. Todo sincronizado con tu Google Calendar.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos pacientes prefieren hablar en euskera. NodeFlow detecta el idioma y responde con voz natural de locutor vasco nativo.` },
      { icon: '💊', title: 'Informa sobre seguros y mutuas', text: 'El asistente responde preguntas sobre qué seguros cubre tu clínica (Adeslas, Sanitas, Asisa, Mapfre) antes de que el paciente reserve.' },
      { icon: '📅', title: 'Recordatorios de sesión automáticos', text: 'Envía recordatorios 24h antes de cada sesión. Reduce cancelaciones de última hora y optimiza la agenda de la clínica.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA puede informar sobre seguros y mutuas en mi clínica de fisio en ${city.nameEs}?`,
        a: `Sí. Configuramos el asistente con todos los seguros y mutuas con los que trabaja tu clínica (Adeslas, Sanitas, Asisa, Mapfre...). El paciente puede preguntar antes de reservar y recibir respuesta inmediata.`,
      },
      {
        q: `¿Puede gestionar el alta de nuevos pacientes en ${city.nameEs}?`,
        a: `Sí. NodeFlow gestiona primeras visitas, recoge los datos básicos del paciente y confirma la cita en tu calendario. El fisioterapeuta recibe un resumen antes de la sesión.`,
      },
      {
        q: `¿Funciona en euskera para pacientes de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del paciente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para una clínica de fisioterapia en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', '-40% no-shows', 'Seguros y mutuas', '24/7 disponibilidad'],
    ctaTitle: (city) => `Tu clínica de fisio en ${city.nameEs} merece<br><span class="grad-text">cero interrupciones</span>`,
  },
  psicologia: {
    name: 'Psicología',
    nameSingular: 'consulta de psicología',
    icon: '🧠',
    emoji: '🧠',
    sectorLabel: 'Psicología y salud mental',
    titleKeyword: 'Psicología con IA',
    heroLine1: 'Tu consulta de psicología en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'un paciente',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu consulta de psicología en ${city.nameEs}, gestiona citas con total discreción, responde sobre servicios y seguros — y habla euskera nativo.`,
    problems: [
      {
        icon: '📵',
        title: 'Interrupciones durante las sesiones',
        text: (city) => `Cuando estás en sesión con un paciente en ${city.nameEs}, no puedes coger el teléfono. Perder esa llamada puede significar perder a alguien que necesita ayuda urgente.`,
      },
      {
        icon: '🔒',
        title: 'Confidencialidad y discreción',
        text: (city) => `Los pacientes de ${city.nameEs} que buscan ayuda psicológica valoran especialmente la discreción. Un asistente que gestione las llamadas sin revelar datos sensibles es fundamental.`,
      },
      {
        icon: '📋',
        title: 'Gestión de agenda entre sesiones',
        text: () => `Gestionar la agenda, confirmar citas y recordar a los pacientes consume tiempo valioso que podrías dedicar a la preparación de sesiones o al descanso entre pacientes.`,
      },
    ],
    benefits: [
      { icon: '🧠', title: 'Discreción y confidencialidad total', text: 'El asistente gestiona llamadas con total discreción. No revela datos de otros pacientes ni información sensible. Cumple RGPD.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos pacientes prefieren hablar en euskera. NodeFlow detecta el idioma y responde con voz natural de locutor vasco nativo.` },
      { icon: '📅', title: 'Gestión de citas sin interrupciones', text: 'El asistente gestiona nuevas citas, cancelaciones y modificaciones sin que tengas que interrumpir las sesiones.' },
      { icon: '💊', title: 'Informa sobre seguros y servicios', text: 'El asistente responde sobre qué seguros cubre tu consulta y qué tipo de terapias ofreces, antes de que el paciente reserve.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA gestiona las llamadas con discreción para mi consulta de psicología en ${city.nameEs}?`,
        a: `Sí. NodeFlow está diseñado para gestionar llamadas con total discreción. No revela información de otros pacientes ni datos sensibles. Cumple con el RGPD y la normativa de protección de datos sanitarios.`,
      },
      {
        q: `¿Puede gestionar primeras consultas de nuevos pacientes en ${city.nameEs}?`,
        a: `Sí. NodeFlow gestiona las llamadas de nuevos pacientes, recoge los datos básicos de contacto y confirma la cita de primera consulta en tu calendario. Tú recibes un resumen antes de la sesión.`,
      },
      {
        q: `¿Funciona en euskera para pacientes de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del paciente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para una consulta de psicología en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', 'RGPD compliant', 'Discreción total', '24/7 disponibilidad'],
    ctaTitle: (city) => `Tu consulta de psicología en ${city.nameEs} merece<br><span class="grad-text">cero llamadas perdidas</span>`,
  },
  talleres: {
    name: 'Talleres Mecánicos',
    nameSingular: 'taller mecánico',
    icon: '🔧',
    emoji: '🔧',
    sectorLabel: 'Talleres mecánicos y automoción',
    titleKeyword: 'Talleres con IA',
    heroLine1: 'Tu taller en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'un cliente',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu taller mecánico en ${city.nameEs}, gestiona citas para revisiones, responde sobre presupuestos y tiempos de entrega — y habla euskera nativo.`,
    problems: [
      {
        icon: '📵',
        title: 'Ocupado bajo el capó, teléfono sin atender',
        text: (city) => `Cuando estás trabajando en un vehículo en ${city.nameEs}, no puedes coger el teléfono. Cada llamada perdida es un cliente que llama al taller de la esquina.`,
      },
      {
        icon: '🕗',
        title: 'Consultas de presupuesto fuera de horario',
        text: (city) => `Muchos conductores en ${city.nameEs} llaman para pedir presupuesto por la tarde o el fin de semana. Sin respuesta, se van a la competencia con servicio online.`,
      },
      {
        icon: '📋',
        title: 'Gestión manual de citas para ITV y revisiones',
        text: () => `Coordinar las citas para ITV, cambios de aceite, revisiones y reparaciones consume tiempo del equipo que debería dedicarse al trabajo mecánico.`,
      },
    ],
    benefits: [
      { icon: '🔧', title: 'Gestión de citas y revisiones', text: 'El asistente gestiona citas para ITV, cambios de aceite, revisiones periódicas y reparaciones. Sincronizado con tu Google Calendar.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos clientes prefieren hablar en euskera. NodeFlow detecta el idioma y responde con voz natural de locutor vasco nativo.` },
      { icon: '💰', title: 'Presupuestos y tiempos de entrega', text: 'El asistente informa sobre precios orientativos de servicios habituales y tiempos de entrega estimados, ahorrando llamadas de consulta.' },
      { icon: '📅', title: 'Recordatorios de revisión automáticos', text: 'Envía recordatorios automáticos a clientes con revisiones periódicas próximas. Incrementa la fidelización y los ingresos recurrentes.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA puede gestionar citas para revisiones e ITV en ${city.nameEs}?`,
        a: `Sí. NodeFlow gestiona citas para todos los servicios de tu taller: ITV, cambios de aceite, revisiones periódicas, reparaciones, etc. Todo sincronizado con tu Google Calendar en tiempo real.`,
      },
      {
        q: `¿Puede informar sobre precios y tiempos de entrega en mi taller de ${city.nameEs}?`,
        a: `Sí. Configuramos el asistente con los precios orientativos de tus servicios habituales. El cliente puede preguntar "¿cuánto cuesta un cambio de aceite?" y recibir respuesta inmediata.`,
      },
      {
        q: `¿Funciona en euskera para clientes de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del cliente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para un taller mecánico en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', 'Presupuestos 24/7', 'Recordatorios automáticos', '0 llamadas perdidas'],
    ctaTitle: (city) => `Tu taller en ${city.nameEs} merece<br><span class="grad-text">un recepcionista que nunca para</span>`,
  },
  gimnasios: {
    name: 'Gimnasios',
    nameSingular: 'gimnasio',
    icon: '💪',
    emoji: '💪',
    sectorLabel: 'Gimnasios y centros deportivos',
    titleKeyword: 'Gimnasios con IA',
    heroLine1: 'Tu gimnasio en',
    heroLine2: 'nunca más pierde',
    heroLine3: 'un socio',
    heroSub: (city) => `NodeFlow atiende el 100% de las llamadas de tu gimnasio o centro deportivo en ${city.nameEs}, gestiona altas de socios, reserva clases y responde sobre tarifas — y habla euskera nativo. Las 24 horas.`,
    problems: [
      {
        icon: '📵',
        title: 'Recepción desbordada en horas punta',
        text: (city) => `A las 7h y a las 18h en ${city.nameEs}, cuando más llaman los socios potenciales, tu recepción está desbordada atendiendo en mostrador. Cada llamada perdida es un socio que no llega a apuntarse.`,
      },
      {
        icon: '🕗',
        title: 'Consultas de precio y horarios fuera de horario',
        text: (city) => `Muchas personas en ${city.nameEs} deciden apuntarse al gimnasio por la noche o el fin de semana. Sin respuesta inmediata sobre tarifas y horarios, se apuntan a la competencia.`,
      },
      {
        icon: '📋',
        title: 'Gestión manual de reservas de clases',
        text: () => `Coordinar las reservas de clases colectivas (spinning, yoga, pilates, boxeo) por teléfono es un trabajo ingente. El asistente lo automatiza completamente.`,
      },
    ],
    benefits: [
      { icon: '💪', title: 'Altas de socios y reserva de clases', text: 'El asistente gestiona consultas de alta, explica tarifas y reserva plazas en clases colectivas. Todo automático.' },
      { icon: '🌐', title: 'Bilingüe euskera-castellano', text: (city) => `En ${city.province}, muchos clientes prefieren hablar en euskera. NodeFlow detecta el idioma y responde con voz natural de locutor vasco nativo.` },
      { icon: '💰', title: 'Informa sobre tarifas y promociones', text: 'El asistente responde sobre tarifas mensuales, bonos, matrículas, descuentos y promociones vigentes en tiempo real.' },
      { icon: '🌙', title: 'Consultas 24/7', text: 'Los gimnasios con NodeFlow reciben consultas de alta incluso a las 23h. El asistente responde y crea el lead para que el equipo lo gestione al día siguiente.' },
    ],
    faqs: (city) => [
      {
        q: `¿El asistente IA puede gestionar altas de socios en mi gimnasio de ${city.nameEs}?`,
        a: `Sí. NodeFlow responde consultas sobre tarifas, instalaciones y servicios, y puede recoger los datos de contacto de personas interesadas en darse de alta para que tu equipo los contacte.`,
      },
      {
        q: `¿Puede informar sobre horarios y clases en mi gimnasio de ${city.nameEs}?`,
        a: `Sí. Configuramos el asistente con el horario de clases colectivas de tu gimnasio. El cliente puede preguntar "¿a qué hora es la clase de spinning?" y recibir respuesta inmediata.`,
      },
      {
        q: `¿Funciona en euskera para socios de ${city.nameEs}?`,
        a: `Sí. ${city.euskeraNote} NodeFlow usa voces de locutores vascos nativos y detecta automáticamente el idioma del cliente.`,
      },
      {
        q: `¿Cuánto cuesta NodeFlow para un gimnasio en ${city.nameEs}?`,
        a: `Plan Negocio desde 49€/mes (500 min/mes). Plan Pro 99€/mes (2.000 min, asistentes ilimitados). 14 días gratis. Sin permanencias.`,
      },
    ],
    stats: ['100% llamadas atendidas', 'Altas automáticas', 'Horarios 24/7', '0 consultas perdidas'],
    ctaTitle: (city) => `Tu gimnasio en ${city.nameEs} merece<br><span class="grad-text">cero socios potenciales perdidos</span>`,
  },
};

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generatePage(sectorKey, cityKey) {
  const sector = sectors[sectorKey];
  const city = cities[cityKey];

  const canonicalUrl = `https://nodeflow.es/${sectorKey}/${cityKey}`;
  const title = `${sector.name} en ${city.nameEs} con IA | NodeFlow`;
  const metaDesc = `Asistente IA para ${sector.name.toLowerCase()} en ${city.nameEs}. Recepcionista virtual que atiende llamadas 24/7, gestiona citas y habla euskera nativo. Sin permanencias. Desde 49€/mes.`;

  const problemsHtml = sector.problems.map(p => `
      <div class="problem-card">
        <div class="problem-icon">${p.icon}</div>
        <h3>${p.title}</h3>
        <p>${typeof p.text === 'function' ? p.text(city) : p.text}</p>
      </div>`).join('\n');

  const benefitsHtml = sector.benefits.map(b => `
      <div class="benefit-card">
        <div class="benefit-icon">${b.icon}</div>
        <div>
          <h3>${b.title}</h3>
          <p>${typeof b.text === 'function' ? b.text(city) : b.text}</p>
        </div>
      </div>`).join('\n');

  const faqs = sector.faqs(city);
  const faqsHtml = faqs.map(f => `
        <div class="faq-item">
          <div class="faq-q">${f.q}<span class="faq-icon">+</span></div>
          <div class="faq-a"><div class="faq-a-inner">${f.a}</div></div>
        </div>`).join('\n');

  const faqSchema = faqs.map(f => `{
          "@type": "Question",
          "name": "${f.q.replace(/"/g, '\\"')}",
          "acceptedAnswer": {"@type": "Answer", "text": "${f.a.replace(/"/g, '\\"')}"}
        }`).join(',\n        ');

  const statsHtml = sector.stats.map(s => {
    const parts = s.split(' ');
    const val = parts[0];
    const label = parts.slice(1).join(' ');
    return `<div class="stat"><strong>${val}</strong><small>${label}</small></div>`;
  }).join('\n      ');

  const sectorNameDisplay = sector.name;
  const heroLine1 = sector.heroLine1;
  const ctaTitle = typeof sector.ctaTitle === 'function' ? sector.ctaTitle(city) : sector.ctaTitle;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="${metaDesc}">
  <meta name="keywords" content="${sector.nameSingular} ${city.nameEs}, recepcionista IA ${city.nameEs}, asistente virtual ${sector.nameSingular} ${city.nameEs}, citas automáticas ${city.province}, IA ${sector.nameSingular} euskera, NodeFlow ${city.nameEs}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="NodeFlow">
  <meta name="geo.region" content="${city.region}">
  <meta name="geo.placename" content="${city.name}, ${city.province}">
  <meta name="geo.position" content="${city.lat};${city.lon}">
  <meta name="ICBM" content="${city.lat}, ${city.lon}">
  <link rel="canonical" href="${canonicalUrl}">

  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:image" content="https://nodeflow.es/og-image.png">
  <meta property="og:locale" content="es_ES">
  <meta property="og:locale:alternate" content="eu_ES">
  <meta property="og:site_name" content="NodeFlow">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${metaDesc}">
  <meta name="twitter:image" content="https://nodeflow.es/og-image.png">

  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZPKHPG2BLC"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ZPKHPG2BLC');</script>
  <!-- Plausible Analytics -->
  <script defer data-domain="nodeflow.es" src="https://plausible.io/js/script.js"></script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "LocalBusiness",
        "@id": "${canonicalUrl}#localbusiness",
        "name": "NodeFlow — ${sectorNameDisplay} en ${city.nameEs}",
        "description": "Asistente virtual con inteligencia artificial para ${sector.name.toLowerCase()} en ${city.nameEs} y ${city.province}. Atención de llamadas 24/7, reservas automáticas y euskera nativo.",
        "url": "${canonicalUrl}",
        "telephone": "+34666351319",
        "email": "unai@nodeflow.es",
        "address": {
          "@type": "PostalAddress",
          "addressLocality": "${city.name}",
          "addressRegion": "${city.province}",
          "postalCode": "${city.postalCode}",
          "addressCountry": "ES"
        },
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": ${city.lat},
          "longitude": ${city.lon}
        },
        "areaServed": [
          {"@type": "City", "name": "${city.name}"},
          {"@type": "AdministrativeArea", "name": "${city.province}"}
        ],
        "priceRange": "€€",
        "openingHours": "Mo-Su 00:00-23:59",
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Planes NodeFlow",
          "itemListElement": [
            {"@type": "Offer", "name": "Plan Negocio", "price": "49", "priceCurrency": "EUR"},
            {"@type": "Offer", "name": "Plan Pro", "price": "99", "priceCurrency": "EUR"}
          ]
        }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {"@type": "ListItem", "position": 1, "name": "NodeFlow", "item": "https://nodeflow.es"},
          {"@type": "ListItem", "position": 2, "name": "${sectorNameDisplay}", "item": "https://nodeflow.es/${sectorKey}"},
          {"@type": "ListItem", "position": 3, "name": "${city.nameEs}", "item": "${canonicalUrl}"}
        ]
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
        ${faqSchema}
        ]
      }
    ]
  }
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">

  <style>
    :root{--bg:#07070e;--bg2:#0f0f18;--card:#14141e;--card-hover:#1c1c28;--accent:#6c5ce7;--accent-l:#a29bfe;--glow:rgba(108,92,231,0.3);--glow-s:rgba(108,92,231,0.12);--green:#00cec9;--green-glow:rgba(0,206,201,0.2);--red:#ff6b6b;--yellow:#feca57;--text:#e8e8f0;--dim:#8888a8;--muted:#3a3a52;--border:rgba(255,255,255,0.07);--border-accent:rgba(108,92,231,0.3);--r:14px}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden}
    .container{max-width:1100px;margin:0 auto;padding:0 24px}
    a{text-decoration:none;color:inherit}
    .noise{position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:180px;opacity:0.025;animation:grain .4s steps(1) infinite}
    @keyframes grain{0%{transform:translate(0,0)}20%{transform:translate(-3%,-2%)}40%{transform:translate(2%,3%)}60%{transform:translate(-1%,2%)}80%{transform:translate(3%,-1%)}}
    .orb{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
    .orb-1{width:600px;height:600px;top:-200px;left:-150px;background:radial-gradient(circle,rgba(108,92,231,0.3) 0%,transparent 70%);animation:drift1 22s ease-in-out infinite}
    .orb-2{width:400px;height:400px;bottom:50px;right:-100px;background:radial-gradient(circle,rgba(0,206,201,0.2) 0%,transparent 70%);animation:drift2 28s ease-in-out infinite}
    @keyframes drift1{0%,100%{transform:translate(0,0)}50%{transform:translate(60px,80px)}}
    @keyframes drift2{0%,100%{transform:translate(0,0)}50%{transform:translate(-50px,-40px)}}
    .grid-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,0.035) 1px,transparent 1px);background-size:32px 32px;mask-image:radial-gradient(ellipse 80% 60% at 50% 30%,black 40%,transparent 100%)}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:600;transition:all .25s;cursor:pointer;border:none;white-space:nowrap;position:relative;overflow:hidden}
    .btn-primary{background:var(--accent);color:#fff;box-shadow:0 4px 24px var(--glow)}
    .btn-primary::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);transform:translateX(-100%);transition:transform .6s}
    .btn-primary:hover::before{transform:translateX(100%)}
    .btn-primary:hover{background:#7c6cf7;transform:translateY(-2px);box-shadow:0 10px 36px var(--glow)}
    .btn-outline{background:transparent;color:var(--text);border:1px solid rgba(255,255,255,0.15)}
    .btn-outline:hover{border-color:var(--accent-l);background:rgba(108,92,231,0.08);transform:translateY(-2px)}
    .btn-lg{padding:16px 36px;font-size:16px;border-radius:12px}
    nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0;transition:all .4s}
    nav::before{content:'';position:absolute;inset:0;background:rgba(7,7,14,0);backdrop-filter:blur(0px);border-bottom:1px solid transparent;transition:all .4s}
    nav.scrolled::before{background:rgba(7,7,14,0.9);backdrop-filter:blur(24px);border-bottom-color:var(--border)}
    .nav-inner{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1}
    .logo{font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--text)}
    .logo em{color:var(--accent-l);font-style:normal}
    .nav-links{display:flex;gap:4px;align-items:center}
    .nav-links a{color:var(--dim);font-size:14px;font-weight:500;padding:8px 14px;border-radius:8px;transition:all .2s}
    .nav-links a:hover{color:var(--text);background:rgba(255,255,255,0.05)}
    .hamburger{display:none;flex-direction:column;gap:5px;cursor:pointer;padding:8px;background:none;border:none}
    .hamburger span{width:22px;height:2px;background:var(--text);border-radius:2px;display:block}
    .mobile-menu{display:none;position:fixed;top:57px;left:0;right:0;background:rgba(7,7,14,0.97);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);padding:16px 24px;flex-direction:column;gap:4px;z-index:99}
    .mobile-menu a{color:var(--dim);font-size:15px;font-weight:500;padding:12px 0;border-bottom:1px solid var(--border);display:block}
    .mobile-menu a:last-child{border-bottom:none}
    .mobile-menu.open{display:flex}
    @media(max-width:768px){.nav-links{display:none}.nav-cta{display:none}.hamburger{display:flex}}
    .breadcrumb{padding:90px 0 0;position:relative;z-index:2}
    .bc-list{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--muted);flex-wrap:wrap}
    .bc-list a{color:var(--accent-l);transition:color .2s}
    .bc-list a:hover{color:#fff}
    .hero{padding:28px 0 90px;text-align:center;position:relative;z-index:2;min-height:85vh;display:flex;align-items:center}
    .hero .container{position:relative;z-index:2;width:100%}
    .badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px 6px 10px;border-radius:100px;border:1px solid rgba(108,92,231,0.4);background:rgba(108,92,231,0.12);font-size:13px;font-weight:500;color:var(--accent-l);margin-bottom:28px}
    .badge-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(0.85)}}
    .hero h1{font-size:clamp(36px,6vw,72px);font-weight:900;letter-spacing:-3px;line-height:1.04;margin-bottom:22px;color:#fff}
    .grad-text{background:linear-gradient(140deg,#fff 30%,rgba(255,255,255,0.7) 60%,var(--accent-l) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .hero-sub{font-size:18px;color:var(--dim);max-width:580px;margin:0 auto 36px;line-height:1.75}
    .hero-ctas{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
    .hero-trust{margin-top:20px;font-size:13px;color:var(--muted);display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
    .hero-trust span{display:flex;align-items:center;gap:5px}
    .hero-trust .dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
    .stats-bar{display:flex;gap:0;justify-content:center;margin-top:60px;padding-top:48px;border-top:1px solid var(--border);flex-wrap:wrap}
    .stat{flex:1;min-width:120px;text-align:center;padding:0 20px;border-right:1px solid var(--border)}
    .stat:last-child{border-right:none}
    .stat strong{display:block;font-size:36px;font-weight:900;color:var(--green);letter-spacing:-1.5px}
    .stat small{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;display:block}
    section{position:relative;z-index:2}
    .section-label{font-size:11px;text-transform:uppercase;letter-spacing:2.5px;color:var(--accent-l);font-weight:700;margin-bottom:12px}
    .section-title{font-size:clamp(26px,3.5vw,40px);font-weight:800;letter-spacing:-1.2px;line-height:1.15;margin-bottom:14px}
    .section-sub{color:var(--dim);font-size:16px;line-height:1.75;max-width:560px}
    .section-pad{padding:80px 0}
    .section-pad-sm{padding:60px 0}
    .problem-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:48px}
    @media(max-width:768px){.problem-grid{grid-template-columns:1fr}}
    .problem-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;position:relative;overflow:hidden;transition:all .3s}
    .problem-card:hover{border-color:rgba(255,107,107,0.3);transform:translateY(-4px)}
    .problem-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#ff6b6b,transparent)}
    .problem-icon{font-size:28px;margin-bottom:14px}
    .problem-card h3{font-size:16px;font-weight:700;margin-bottom:10px}
    .problem-card p{font-size:14px;color:var(--dim);line-height:1.7}
    .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:48px;position:relative}
    .steps::before{content:'';position:absolute;top:28px;left:16.6%;right:16.6%;height:1px;background:linear-gradient(90deg,transparent,var(--border-accent),transparent)}
    @media(max-width:768px){.steps{grid-template-columns:1fr}.steps::before{display:none}}
    .step{text-align:center;padding:28px 20px}
    .step-num{width:56px;height:56px;border-radius:50%;background:rgba(108,92,231,0.15);border:1px solid var(--border-accent);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:var(--accent-l);margin:0 auto 18px}
    .step h3{font-size:16px;font-weight:700;margin-bottom:10px}
    .step p{font-size:14px;color:var(--dim);line-height:1.7}
    .benefits-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:48px}
    @media(max-width:768px){.benefits-grid{grid-template-columns:1fr}}
    .benefit-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px 30px;display:flex;gap:18px;align-items:flex-start;transition:all .3s}
    .benefit-card:hover{border-color:var(--border-accent);transform:translateY(-3px);background:var(--card-hover)}
    .benefit-icon{width:44px;height:44px;border-radius:12px;background:rgba(108,92,231,0.15);border:1px solid rgba(108,92,231,0.25);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
    .benefit-card h3{font-size:15px;font-weight:700;margin-bottom:7px}
    .benefit-card p{font-size:13px;color:var(--dim);line-height:1.65}
    .faq-list{display:flex;flex-direction:column;gap:12px;margin-top:40px}
    .faq-item{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;transition:border-color .3s}
    .faq-item:hover{border-color:var(--border-accent)}
    .faq-q{padding:20px 24px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:16px;font-weight:600;font-size:15px;user-select:none}
    .faq-icon{width:24px;height:24px;border-radius:50%;background:rgba(108,92,231,0.15);border:1px solid rgba(108,92,231,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent-l);font-size:16px;transition:transform .3s}
    .faq-item.open .faq-icon{transform:rotate(45deg)}
    .faq-a{max-height:0;overflow:hidden;transition:max-height .4s ease}
    .faq-item.open .faq-a{max-height:300px}
    .faq-a-inner{padding:0 24px 20px;font-size:14px;color:var(--dim);line-height:1.75}
    .cta-section{text-align:center;padding:80px 0 100px}
    .cta-card{background:linear-gradient(135deg,rgba(108,92,231,0.12),rgba(0,206,201,0.06));border:1px solid var(--border-accent);border-radius:28px;padding:60px 40px;position:relative;overflow:hidden}
    .cta-card::before{content:'';position:absolute;top:-60%;left:-10%;width:80%;height:200%;background:radial-gradient(ellipse,rgba(108,92,231,0.12) 0%,transparent 70%);pointer-events:none}
    .cta-card h2{font-size:clamp(26px,4vw,44px);font-weight:900;letter-spacing:-1.5px;margin-bottom:16px}
    .cta-card p{color:var(--dim);font-size:17px;margin-bottom:32px;max-width:520px;margin-left:auto;margin-right:auto}
    .cta-price{font-size:13px;color:var(--muted);margin-top:14px}
    .wa-float{position:fixed;bottom:24px;right:24px;z-index:200;width:56px;height:56px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-size:28px;text-decoration:none;box-shadow:0 4px 24px rgba(37,211,102,0.5);transition:transform .2s}
    .wa-float:hover{transform:scale(1.1)}
    footer{border-top:1px solid var(--border);padding:40px 0}
    .footer-inner{display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;align-items:center}
    .footer-brand{font-weight:700;font-size:16px}
    .footer-brand span{color:var(--accent-l)}
    .footer-links{display:flex;gap:20px;flex-wrap:wrap}
    .footer-links a{font-size:13px;color:var(--dim);transition:color .2s}
    .footer-links a:hover{color:var(--text)}
    .footer-copy{font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
<div class="noise"></div>
<div class="grid-bg"></div>
<div class="orb orb-1"></div>
<div class="orb orb-2"></div>

<nav id="navbar">
  <div class="container">
    <div class="nav-inner">
      <a href="https://nodeflow.es" class="logo">Node<em>Flow</em></a>
      <div class="nav-links">
        <a href="#problema">El problema</a>
        <a href="#como-funciona">Cómo funciona</a>
        <a href="#beneficios">Beneficios</a>
        <a href="#faq">FAQ</a>
        <a href="https://nodeflow.es/${sectorKey}" style="color:var(--dim)">← ${sectorNameDisplay}</a>
      </div>
      <a href="/onboarding?sector=${sectorKey}&ciudad=${cityKey}" class="btn btn-primary nav-cta" style="padding:9px 20px;font-size:13px;">Empezar gratis →</a>
      <button class="hamburger" id="hamburger" aria-label="Menú"><span></span><span></span><span></span></button>
    </div>
  </div>
</nav>
<div class="mobile-menu" id="mobileMenu">
  <a href="#problema">El problema</a>
  <a href="#como-funciona">Cómo funciona</a>
  <a href="#beneficios">Beneficios</a>
  <a href="#faq">Preguntas frecuentes</a>
  <a href="https://nodeflow.es/${sectorKey}">← ${sectorNameDisplay}</a>
  <a href="https://nodeflow.es">← Inicio NodeFlow</a>
  <a href="/onboarding?sector=${sectorKey}&ciudad=${cityKey}" style="color:var(--accent-l);font-weight:700;">Empezar gratis →</a>
</div>

<div class="breadcrumb">
  <div class="container">
    <nav aria-label="breadcrumb">
      <ol class="bc-list">
        <li><a href="https://nodeflow.es">NodeFlow</a></li>
        <li style="color:var(--muted)">›</li>
        <li><a href="https://nodeflow.es/${sectorKey}">${sectorNameDisplay}</a></li>
        <li style="color:var(--muted)">›</li>
        <li aria-current="page">${city.nameEs}</li>
      </ol>
    </nav>
  </div>
</div>

<section class="hero">
  <div class="container">
    <div class="badge">
      <span class="badge-dot"></span>
      ${sector.emoji} ${sectorNameDisplay} · 📍 ${city.nameEs}, ${city.province}
    </div>
    <h1>
      ${heroLine1} <span class="grad-text">${city.nameEs}</span><br>
      ${sector.heroLine2}<br>
      ${sector.heroLine3}
    </h1>
    <p class="hero-sub">${typeof sector.heroSub === 'function' ? sector.heroSub(city) : sector.heroSub}</p>
    <div class="hero-ctas">
      <a href="/onboarding?sector=${sectorKey}&ciudad=${cityKey}" class="btn btn-primary btn-lg">Empezar gratis 14 días →</a>
      <a href="#como-funciona" class="btn btn-outline btn-lg">Cómo funciona</a>
    </div>
    <div class="hero-trust">
      <span><span class="dot"></span> Sin permanencia</span>
      <span><span class="dot"></span> Activo en minutos</span>
      <span><span class="dot"></span> Habla euskera nativo</span>
      <span><span class="dot"></span> Desde 49€/mes</span>
    </div>
    <div class="stats-bar">
      ${statsHtml}
    </div>
  </div>
</section>

<section class="section-pad" id="problema">
  <div class="container">
    <div class="section-label">El problema</div>
    <h2 class="section-title">¿Por qué los ${sector.name.toLowerCase()} de ${city.nameEs}<br>pierden clientes cada semana?</h2>
    <p class="section-sub">En ${city.area}, la competencia es alta. Si no coges el teléfono, el cliente llama al siguiente de la lista.</p>
    <div class="problem-grid">
      ${problemsHtml}
    </div>
  </div>
</section>

<section class="section-pad" id="como-funciona" style="background:rgba(255,255,255,0.015);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="container">
    <div style="text-align:center;margin-bottom:16px;">
      <div class="section-label">Cómo funciona</div>
      <h2 class="section-title">Tres pasos. Sin instalar nada.</h2>
      <p class="section-sub" style="margin:0 auto;">Conectamos NodeFlow a tu línea actual en pocos minutos. Sin cambiar tu número de teléfono.</p>
    </div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <h3>Nos cuentas tu ${sector.nameSingular}</h3>
        <p>Horarios, servicios y precios. En un formulario de 10 minutos configuramos el asistente con todo lo que necesita saber sobre tu ${sector.nameSingular} en ${city.nameEs}.</p>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <h3>Conectamos las llamadas</h3>
        <p>Cuando no puedes coger el teléfono, las llamadas van al asistente. Tu número de siempre, sin cambios. Lo configuramos todo en pocos minutos.</p>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <h3>El asistente trabaja por ti</h3>
        <p>Gestiona citas en tu Google Calendar, responde preguntas y confirma reservas. Tú recibes un resumen de cada llamada por WhatsApp o email.</p>
      </div>
    </div>
  </div>
</section>

<section class="section-pad" id="beneficios">
  <div class="container">
    <div class="section-label">Beneficios específicos</div>
    <h2 class="section-title">Diseñado para ${sector.name.toLowerCase()}<br>de ${city.area}</h2>
    <p class="section-sub">No es un bot genérico. NodeFlow se configura con los detalles de tu ${sector.nameSingular} en ${city.nameEs}.</p>
    <div class="benefits-grid">
      ${benefitsHtml}
    </div>
  </div>
</section>

<section class="section-pad" id="faq" style="background:rgba(255,255,255,0.015);border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
  <div class="container" style="max-width:760px">
    <div style="text-align:center;margin-bottom:8px;">
      <div class="section-label">Preguntas frecuentes</div>
      <h2 class="section-title">Todo sobre NodeFlow para<br>${sector.name.toLowerCase()} en ${city.nameEs}</h2>
    </div>
    <div class="faq-list">
      ${faqsHtml}
    </div>
  </div>
</section>

<section class="cta-section">
  <div class="container" style="max-width:800px">
    <div class="cta-card">
      <div class="section-label" style="text-align:center">${sectorNameDisplay} en ${city.nameEs}</div>
      <h2>${ctaTitle}</h2>
      <p>14 días gratis. Sin tarjeta de crédito. Activo en minutos. Cancela cuando quieras.</p>
      <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap">
        <a href="/onboarding?sector=${sectorKey}&ciudad=${cityKey}" class="btn btn-primary btn-lg">Empezar gratis 14 días →</a>
        <a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20tengo%20un%20${encodeURIComponent(sector.nameSingular)}%20en%20${encodeURIComponent(city.nameEs)}%20y%20quiero%20informaci%C3%B3n%20sobre%20NodeFlow" class="btn btn-outline btn-lg" style="color:#25d366;border-color:rgba(37,211,102,0.3)">💬 WhatsApp</a>
      </div>
      <p class="cta-price">Desde 49€/mes · Sin permanencia · Activo en minutos · Hecho en Euskal Herria</p>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="footer-inner">
      <div>
        <div class="footer-brand">⚡ Node<span>Flow</span></div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">IA de voz para ${sector.name.toLowerCase()} en ${city.nameEs} · Hecho en Euskal Herria</div>
      </div>
      <div class="footer-links">
        <a href="https://nodeflow.es">Inicio</a>
        <a href="https://nodeflow.es/${sectorKey}">${sectorNameDisplay}</a>
        <a href="https://nodeflow.es/${cityKey}">${city.nameEs}</a>
        <a href="https://nodeflow.es/bilbao">Bilbao</a>
        <a href="https://nodeflow.es/donostia">Donostia</a>
        <a href="https://nodeflow.es/vitoria">Vitoria</a>
        <a href="https://nodeflow.es/privacidad">Privacidad</a>
        <a href="https://nodeflow.es/terminos">Términos</a>
      </div>
      <div class="footer-copy">© 2026 NodeFlow · unai@nodeflow.es</div>
    </div>
  </div>
</footer>

<a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20vi%20NodeFlow%20para%20${encodeURIComponent(sector.name.toLowerCase())}%20en%20${encodeURIComponent(city.nameEs)}" class="wa-float" target="_blank" title="WhatsApp">💬</a>

<script>
const nav=document.getElementById('navbar');
window.addEventListener('scroll',()=>nav.classList.toggle('scrolled',window.scrollY>40));
document.getElementById('hamburger').addEventListener('click',()=>document.getElementById('mobileMenu').classList.toggle('open'));
document.querySelectorAll('.faq-q').forEach(q=>q.addEventListener('click',()=>{
  const item=q.closest('.faq-item');
  const wasOpen=item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));
  if(!wasOpen)item.classList.add('open');
}));
</script>
</body>
</html>`;
}

// Generate all pages
const publicDir = path.join(__dirname, '..', 'public');
let generated = 0;
const errors = [];

for (const sectorKey of Object.keys(sectors)) {
  for (const cityKey of Object.keys(cities)) {
    const dir = path.join(publicDir, sectorKey, cityKey);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const html = generatePage(sectorKey, cityKey);
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
      console.log(`✓ ${sectorKey}/${cityKey}`);
      generated++;
    } catch (e) {
      console.error(`✗ ${sectorKey}/${cityKey}: ${e.message}`);
      errors.push(`${sectorKey}/${cityKey}: ${e.message}`);
    }
  }
}

console.log(`\nGenerated: ${generated} pages`);
if (errors.length) {
  console.error(`Errors: ${errors.length}`);
  errors.forEach(e => console.error(' -', e));
}
