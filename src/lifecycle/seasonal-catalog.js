// ============================================================
// NodeFlow — Campañas del año por sector (2026-07-07)
// ------------------------------------------------------------
// Estacionales de UN clic: el dueño activa "Neumáticos de invierno"
// y cada 15 de octubre TODOS sus clientes elegibles reciben el aviso.
// El cron ya existía (processCampaigns + org_campaigns); esto aporta
// el CATÁLOGO curado (fecha + texto listos) y su resolución.
//
// El texto viaja por la plantilla-portadora nodeflow_aviso:
// "Hola {nombre}, un mensaje de {negocio}: {texto}". Escríbelos como
// continuación de esa frase (minúscula inicial, cierre con acción).
// ============================================================
'use strict';

const SEASONAL_CATALOG = {
  taller: [
    { key: 'camp_neumaticos_invierno', name: 'Neumáticos de invierno', month: 10, day: 15,
      text: 'llega el frío — ¿revisamos neumáticos y batería y dejamos el coche listo para el invierno? Reserva tu hueco esta semana.' },
    { key: 'camp_aire_verano', name: 'Aire acondicionado a punto', month: 5, day: 2,
      text: 'antes de los calores: revisión y carga del aire acondicionado. Pide cita y viaja fresco todo el verano.' },
  ],
  peluqueria: [
    { key: 'camp_navidad', name: 'Agenda de Navidad', month: 11, day: 20,
      text: 'las fechas de diciembre vuelan — reserva ya tu cita para las fiestas y elige la hora que prefieras.' },
    { key: 'camp_eventos_primavera', name: 'Bodas y comuniones', month: 4, day: 1,
      text: 'arranca la temporada de bodas y comuniones. Si tienes un evento a la vista, reserva con tiempo y llegamos perfectas.' },
  ],
  veterinaria: [
    { key: 'camp_antiparasitarios', name: 'Antiparasitarios de primavera', month: 4, day: 1,
      text: 'con el buen tiempo vuelven pulgas y garrapatas — toca protección antiparasitaria. Pide cita y lo dejamos al día.' },
  ],
  dental: [
    { key: 'camp_vuelta_cole', name: 'Revisión vuelta al cole', month: 9, day: 1,
      text: 'vuelta al cole: buen momento para la revisión dental de los peques. Reserva su cita antes de que se llene la agenda.' },
  ],
  gimnasio: [
    { key: 'camp_enero', name: 'Operación enero', month: 1, day: 2,
      text: 'nuevo año, nuevos propósitos 💪 Vuelve a entrenar con nosotros — te esperamos con la matrícula lista.' },
    { key: 'camp_septiembre', name: 'Vuelta a la rutina', month: 9, day: 1,
      text: 'se acabó el verano: hora de volver a la rutina. Reserva tu plaza y retomamos donde lo dejaste.' },
  ],
  estetica_avanzada: [
    { key: 'camp_verano', name: 'Preparación verano', month: 5, day: 2,
      text: 'el verano se acerca — depilación, facial y puesta a punto. Reserva ahora y llega con tiempo.' },
  ],
  asesoria: [
    { key: 'camp_renta', name: 'Campaña de la Renta', month: 4, day: 1,
      text: 'arranca la campaña de la Renta. Reserva tu cita y la preparamos sin prisas ni sustos.' },
    { key: 'camp_cierre_fiscal', name: 'Cierre fiscal', month: 11, day: 15,
      text: 'diciembre está encima: revisemos tu cierre fiscal a tiempo para optimizar el año. Pide tu cita.' },
  ],
  restaurante: [
    { key: 'camp_navidad_grupos', name: 'Cenas de Navidad', month: 11, day: 2,
      text: '¿ya tenéis plan para la cena de Navidad? Reserva fecha para tu grupo antes de que se agoten los sábados.' },
  ],
  optica: [
    { key: 'camp_vuelta_cole', name: 'Vista lista para el cole', month: 9, day: 1,
      text: 'vuelta al cole: revisión de vista para los peques (y para ti). Pide cita — es rápida y puede marcar el curso.' },
  ],
  fisioterapia: [
    { key: 'camp_pretemporada', name: 'Puesta a punto pretemporada', month: 9, day: 1,
      text: 'si retomas el deporte tras el verano, una puesta a punto evita lesiones. Reserva tu sesión de pretemporada.' },
  ],
  clinica: [
    { key: 'camp_certificados', name: 'Certificados deportivos', month: 9, day: 1,
      text: 'empieza la temporada: si necesitas certificado médico deportivo, te lo dejamos listo en una visita. Pide cita.' },
  ],
  hotel: [
    { key: 'camp_verano_anticipado', name: 'Reserva tu verano', month: 2, day: 1,
      text: 'el verano se llena rápido — reserva ahora tus fechas favoritas y asegúrate la habitación de siempre.' },
  ],
  autoescuela: [
    { key: 'camp_carnet_verano', name: 'Carnet en verano', month: 6, day: 1,
      text: 'el verano es el mejor momento para sacarte el carnet: intensivos con plazas limitadas. Infórmate ya.' },
  ],
  yoga: [
    { key: 'camp_enero', name: 'Empieza el año en calma', month: 1, day: 2,
      text: 'nuevo año — vuelve a tu esterilla. Te guardamos sitio en tu clase favorita.' },
  ],
  pilates: [
    { key: 'camp_septiembre', name: 'Vuelta a clase', month: 9, day: 1,
      text: 'septiembre es el mes perfecto para retomar pilates. Reserva tu plaza — los grupos se llenan pronto.' },
  ],
};

/** Campañas sugeridas para un sector (copia defensiva). */
function getSeasonalForSector(sector) {
  return (SEASONAL_CATALOG[sector] || []).map(c => ({ ...c }));
}

/** Resuelve una campaña del catálogo por su service_key (cualquier sector). */
function findSeasonal(serviceKey) {
  for (const list of Object.values(SEASONAL_CATALOG)) {
    const hit = list.find(c => c.key === serviceKey);
    if (hit) return { ...hit };
  }
  return null;
}

module.exports = { SEASONAL_CATALOG, getSeasonalForSector, findSeasonal };
