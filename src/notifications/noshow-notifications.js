// ============================================
// NodeFlow — No-Show Email Notification v2
// Sector-aware, trilingual (es/eu/gl)
// ============================================
'use strict';

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('NOSHOW-NOTIF');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function firstName(n) { return (n ?? '').split(' ')[0]; }

// ─── Sector config ────────────────────────────────────────────────────────────

const SECTOR_CONFIG = {
  peluqueria:   { emoji: '✂️', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  estetica:     { emoji: '💅', color: '#db2777', light: '#fdf2f8', dark: '#831843' },
  dental:       { emoji: '🦷', color: '#0891b2', light: '#f0f9ff', dark: '#0c4a6e' },
  clinica:      { emoji: '🏥', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  veterinaria:  { emoji: '🐾', color: '#d97706', light: '#fffbeb', dark: '#78350f' },
  taller:       { emoji: '🔧', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  gimnasio:     { emoji: '💪', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  fisioterapia: { emoji: '🏃', color: '#0284c7', light: '#f0f9ff', dark: '#0c4a6e' },
  optica:       { emoji: '👓', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  psicologia:   { emoji: '🧠', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  restaurante:  { emoji: '🍽️', color: '#dc2626', light: '#fff5f5', dark: '#7f1d1d' },
  farmacia:     { emoji: '💊', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  academia:     { emoji: '📚', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  asesoria:     { emoji: '📊', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  yoga:         { emoji: '🧘', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  pilates:      { emoji: '🏃', color: '#db2777', light: '#fdf2f8', dark: '#831843' },
  nutricion:    { emoji: '🥗', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  hotel:        { emoji: '🏨', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  abogados:     { emoji: '⚖️', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  barberia:     { emoji: '💈', color: '#1e293b', light: '#f8fafc', dark: '#0f172a' },
  podologia:        { emoji: '🦶', color: '#0d9488', light: '#f0fdfa', dark: '#134e4a' },
  spa:              { emoji: '🧖', color: '#0891b2', light: '#f0f9ff', dark: '#0c4a6e' },
  agencia_viajes:   { emoji: '✈️', color: '#0284c7', light: '#f0f9ff', dark: '#0c4a6e' },
  inmobiliaria:     { emoji: '🏡', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  coaching:         { emoji: '🎯', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  reformas:         { emoji: '🔨', color: '#b45309', light: '#fffbeb', dark: '#78350f' },
  guarderia_canina: { emoji: '🐶', color: '#d97706', light: '#fffbeb', dark: '#78350f' },
  autoescuela:      { emoji: '🚗', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  default:      { emoji: '📅', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
};

// ─── Per-sector no-show copy ──────────────────────────────────────────────────

const NOSHOW_COPY = {
  peluqueria: {
    es: { hook: 'Reservamos tu hueco para nada', body: 'El estilista tenía ese rato solo para ti. Pasa, son cosas de la vida — ¿lo reagendamos para esta semana?' },
    eu: { hook: 'Zure tartea alferrik gorde genuen', body: 'Estilistak zuretzat bakarrik gorde zuen denbora hori. Gertatzen da — aste honetan berregiten dugu?' },
    gl: { hook: 'Reservámosche o oco para nada', body: 'O estilista tiña ese rato só para ti. Pasa, son cousas da vida — reagendámolo para esta semana?' },
  },
  estetica: {
    es: { hook: 'Tu tratamiento sigue esperando', body: 'La cabina y el horario estaban reservados para ti. Sabemos que surgen imprevistos — ¿buscamos otro hueco esta semana?' },
    eu: { hook: 'Zure tratamenduak zain jarraitzen du', body: 'Kabina eta ordutegia zuretzat gordeta zeuden. Badakigu ezustekoak sortzen direla — beste tarte bat bilatzen dugu aste honetan?' },
    gl: { hook: 'O teu tratamento segue agardando', body: 'A cabina e o horario estaban reservados para ti. Sabemos que xorden imprevistos — buscamos outro oco esta semana?' },
  },
  dental: {
    es: { hook: 'Tu revisión dental sigue pendiente', body: 'El dentista tenía ese hueco bloqueado para ti. Si el dolor o los nervios te frenaron, te entendemos. ¿Lo reagendamos sin compromiso?' },
    eu: { hook: 'Zure hortz azterketak zain jarraitzen du', body: 'Dentistak tarte hori zuretzat gordeta zeukan. Minak edo urduritasunak geldiarazi bazaitu, ulertzen dugu. Konpromisorik gabe berregiten dugu?' },
    gl: { hook: 'A túa revisión dental segue pendente', body: 'O dentista tiña ese oco bloqueado para ti. Se a dor ou os nervios te frearon, enténdémoste. Reagendámolo sen compromiso?' },
  },
  clinica: {
    es: { hook: 'Tu cita médica quedó libre', body: 'Reservamos ese hueco para ti con el médico. Tu salud es lo primero — ¿lo dejamos para la semana que viene?' },
    eu: { hook: 'Zure mediku-hitzordua libre geratu da', body: 'Tarte hori medikuarekin gordeta geneukan zuretzat. Zure osasuna lehenengoa da — datorren asterako uzten dugu?' },
    gl: { hook: 'A túa cita médica quedou libre', body: 'Reservamos ese oco para ti co médico. A túa saúde é o primeiro — deixámolo para a semana que vén?' },
  },
  veterinaria: {
    es: { hook: 'La consulta de tu mascota quedó libre', body: 'El veterinario tenía ese tiempo para vosotros. Las emergencias ocurren — ¿lo reagendamos para esta semana?' },
    eu: { hook: 'Zure maskotaren kontsulta libre geratu da', body: 'Albaitariak denbora hori zuentzat zeukan. Larrialdiak gertatzen dira — aste honetarako berregiten dugu?' },
    gl: { hook: 'A consulta da túa mascota quedou libre', body: 'O veterinario tiña ese tempo para vós. As emerxencias ocorren — reagendámolo para esta semana?' },
  },
  taller: {
    es: { hook: 'El hueco del taller quedó sin usar', body: 'Bloqueamos tiempo y el elevador para tu coche. Sabemos que el día a día complica las cosas — ¿volvemos a intentarlo?' },
    eu: { hook: 'Tailerreko tartea erabili gabe geratu da', body: 'Denbora eta jasogailua zure autorako gorde genituen. Badakigu egunerokoak gauzak zailtzen dituela — berriro saiatzen gara?' },
    gl: { hook: 'O oco do taller quedou sen usar', body: 'Bloqueamos tempo e o elevador para o teu coche. Sabemos que o día a día complica as cousas — volvemos intentalo?' },
  },
  gimnasio: {
    es: { hook: 'Te echamos de menos en la sesión', body: 'La clase de hoy tenía tu plaza reservada. Sin drama — los hábitos se construyen día a día. ¿Reservamos la próxima sesión?' },
    eu: { hook: 'Faltan izan zaitugu saioan', body: 'Gaurko klaseak zure plaza gordeta zeukan. Dramarik gabe — ohiturak egunez egun eraikitzen dira. Hurrengo saioa hartzen dugu?' },
    gl: { hook: 'Botámoste de menos na sesión', body: 'A clase de hoxe tiña a túa praza reservada. Sen drama — os hábitos constrúense día a día. Reservamos a próxima sesión?' },
  },
  fisioterapia: {
    es: { hook: 'Tu sesión de fisio quedó libre', body: 'El fisioterapeuta tenía ese rato reservado para ti. Los tratamientos funcionan mejor cuando no se interrumpen — ¿lo reagendamos?' },
    eu: { hook: 'Zure fisio saioa libre geratu da', body: 'Fisioterapeutak tarte hori zuretzat gordeta zeukan. Tratamenduek hobeto funtzionatzen dute eten gabe — berregiten dugu?' },
    gl: { hook: 'A túa sesión de fisio quedou libre', body: 'O fisioterapeuta tiña ese rato reservado para ti. Os tratamentos funcionan mellor cando non se interrompen — reagendámolo?' },
  },
  restaurante: {
    es: { hook: 'Guardamos vuestra mesa sin noticias', body: 'Teníamos mesa y sillas listas para vosotros. Se entiende que pueden surgir contratiempos — ¿repetimos con una nueva reserva?' },
    eu: { hook: 'Zuen mahaia gorde genuen berririk gabe', body: 'Mahaia eta aulkiak prest geneuzkan zuentzat. Ulertzen da ezustekoak sor daitezkeela — erreserba berri batekin errepikatzen dugu?' },
    gl: { hook: 'Gardamos a vosa mesa sen novas', body: 'Tiñamos mesa e cadeiras listas para vós. Enténdese que poden xurdir contratempos — repetimos cunha nova reserva?' },
  },
  psicologia: {
    es: { hook: 'Tu sesión de hoy quedó libre', body: 'Estaba aquí esperándote. Si hoy no fue el día, no pasa nada — lo importante es que sigas. ¿Lo dejamos para esta semana?' },
    eu: { hook: 'Gaurko zure saioa libre geratu da', body: 'Hemen nengoen zure zain. Gaur ez bazen eguna, ez da ezer gertatzen — garrantzitsuena jarraitzea da. Aste honetarako uzten dugu?' },
    gl: { hook: 'A túa sesión de hoxe quedou libre', body: 'Estaba aquí agardándote. Se hoxe non foi o día, non pasa nada — o importante é que sigas. Deixámolo para esta semana?' },
  },
  podologia: {
    es: { hook: 'Tu cita de podología quedó libre', body: 'El podólogo tenía ese rato reservado para ti. Cuidar tus pies a tiempo importa — ¿lo reagendamos esta semana?' },
    eu: { hook: 'Zure podologia hitzordua libre geratu da', body: 'Podologoak tarte hori zuretzat gordeta zeukan. Zure oinak garaiz zaintzea garrantzitsua da — aste honetan berregiten dugu?' },
    gl: { hook: 'A túa cita de podoloxía quedou libre', body: 'O podólogo tiña ese rato reservado para ti. Coidar os teus pés a tempo importa — reagendámolo esta semana?' },
  },
  spa: {
    es: { hook: 'Tu momento de relax quedó libre', body: 'Teníamos tu cabina lista para desconectar. Sabemos que surgen imprevistos — ¿buscamos otro hueco para mimarte?' },
    eu: { hook: 'Zure erlaxatzeko unea libre geratu da', body: 'Zure kabina prest geneukan deskonektatzeko. Badakigu ezustekoak sortzen direla — beste tarte bat bilatzen dugu zu zaintzeko?' },
    gl: { hook: 'O teu momento de relax quedou libre', body: 'Tiñamos a túa cabina lista para desconectar. Sabemos que xorden imprevistos — buscamos outro oco para mimarte?' },
  },
  agencia_viajes: {
    es: { hook: 'Tu cita para planear el viaje quedó libre', body: 'Teníamos ese rato para ti. Sabemos que el día se complica — ¿retomamos tu escapada con una nueva cita?' },
    eu: { hook: 'Bidaia antolatzeko zure hitzordua libre geratu da', body: 'Tarte hori zuretzat geneukan. Badakigu eguna korapilatzen dela — zure ihesaldia hitzordu berri batekin berreskuratzen dugu?' },
    gl: { hook: 'A túa cita para planear a viaxe quedou libre', body: 'Tiñamos ese rato para ti. Sabemos que o día se complica — retomamos a túa escapada cunha nova cita?' },
  },
  inmobiliaria: {
    es: { hook: 'La visita quedó sin realizar', body: 'Reservamos ese hueco para enseñarte la propiedad. Las agendas se complican — ¿buscamos otro momento esta semana?' },
    eu: { hook: 'Bisita egin gabe geratu da', body: 'Tarte hori gorde genuen jabetza erakusteko. Agendak korapilatu egiten dira — beste une bat bilatzen dugu aste honetan?' },
    gl: { hook: 'A visita quedou sen realizar', body: 'Reservamos ese oco para amosarche a propiedade. As axendas complícanse — buscamos outro momento esta semana?' },
  },
  coaching: {
    es: { hook: 'Tu sesión de hoy quedó libre', body: 'Estaba ese tiempo reservado para tus objetivos. Si hoy no pudo ser, lo importante es seguir — ¿la reagendamos?' },
    eu: { hook: 'Gaurko zure saioa libre geratu da', body: 'Denbora hori zure helburuetarako gordeta zegoen. Gaur ezin izan bada, garrantzitsuena jarraitzea da — berregiten dugu?' },
    gl: { hook: 'A túa sesión de hoxe quedou libre', body: 'Estaba ese tempo reservado para os teus obxectivos. Se hoxe non puido ser, o importante é seguir — reagendámola?' },
  },
  reformas: {
    es: { hook: 'La visita para tu reforma quedó libre', body: 'Teníamos ese rato para ver tu proyecto. Sabemos que surgen imprevistos — ¿buscamos otro día para pasarnos?' },
    eu: { hook: 'Zure erreformarako bisita libre geratu da', body: 'Tarte hori zure proiektua ikusteko geneukan. Badakigu ezustekoak sortzen direla — beste egun bat bilatzen dugu pasatzeko?' },
    gl: { hook: 'A visita para a túa reforma quedou libre', body: 'Tiñamos ese rato para ver o teu proxecto. Sabemos que xorden imprevistos — buscamos outro día para pasarnos?' },
  },
  guarderia_canina: {
    es: { hook: 'La plaza de tu peludo quedó libre', body: 'Teníamos sitio reservado para él. Las cosas cambian — ¿buscamos otra fecha cuando lo necesites?' },
    eu: { hook: 'Zure txakurraren plaza libre geratu da', body: 'Lekua gorde genuen berarentzat. Gauzak aldatzen dira — beste data bat bilatzen dugu behar duzunean?' },
    gl: { hook: 'A praza do teu peludo quedou libre', body: 'Tiñamos sitio reservado para el. As cousas cambian — buscamos outra data cando o precises?' },
  },
  autoescuela: {
    es: { hook: 'Tu clase de hoy quedó libre', body: 'El profesor tenía ese rato reservado para ti. Cada clase te acerca al carnet — ¿la reagendamos esta semana?' },
    eu: { hook: 'Gaurko zure klasea libre geratu da', body: 'Irakasleak tarte hori zuretzat gordeta zeukan. Klase bakoitzak gidabaimenera hurbiltzen zaitu — aste honetan berregiten dugu?' },
    gl: { hook: 'A túa clase de hoxe quedou libre', body: 'O profesor tiña ese rato reservado para ti. Cada clase te achega ao carné — reagendámola esta semana?' },
  },
  nutricion: {
    es: { hook: 'Tu consulta de nutrición quedó libre', body: 'Teníamos ese rato reservado para revisar tu progreso. El seguimiento es lo que marca la diferencia — ¿lo reagendamos esta semana?' },
    eu: { hook: 'Zure nutrizio kontsulta libre geratu da', body: 'Tarte hori zure aurrerapena berrikusteko geneukan. Jarraipenak egiten du aldea — aste honetan berregiten dugu?' },
    gl: { hook: 'A túa consulta de nutrición quedou libre', body: 'Tiñamos ese rato reservado para revisar o teu progreso. O seguimento é o que marca a diferenza — reagendámolo esta semana?' },
  },
  optica: {
    es: { hook: 'Tu revisión visual quedó libre', body: 'Teníamos ese hueco reservado para revisar tu vista. Sabemos que surgen imprevistos — ¿buscamos otro momento esta semana?' },
    eu: { hook: 'Zure ikusmen azterketa libre geratu da', body: 'Tarte hori zure ikusmena berrikusteko geneukan. Badakigu ezustekoak sortzen direla — beste une bat bilatzen dugu aste honetan?' },
    gl: { hook: 'A túa revisión visual quedou libre', body: 'Tiñamos ese oco reservado para revisar a túa vista. Sabemos que xorden imprevistos — buscamos outro momento esta semana?' },
  },
  yoga: {
    es: { hook: 'Tu clase de hoy quedó libre', body: 'Guardábamos tu sitio en la clase. Sin presión — los hábitos se construyen poco a poco. ¿Reservamos la próxima?' },
    eu: { hook: 'Gaurko zure klasea libre geratu da', body: 'Zure lekua gordetzen genuen klasean. Presiorik gabe — ohiturak pixkanaka eraikitzen dira. Hurrengoa hartzen dugu?' },
    gl: { hook: 'A túa clase de hoxe quedou libre', body: 'Gardabamos o teu sitio na clase. Sen presión — os hábitos constrúense pouco a pouco. Reservamos a próxima?' },
  },
  academia: {
    es: { hook: 'Tu clase de hoy quedó libre', body: 'El profesor tenía ese rato reservado para ti. No pierdas el ritmo — ¿retomamos esta semana?' },
    eu: { hook: 'Gaurko zure klasea libre geratu da', body: 'Irakasleak tarte hori zuretzat gordeta zeukan. Ez galdu erritmoa — aste honetan berriz hasten gara?' },
    gl: { hook: 'A túa clase de hoxe quedou libre', body: 'O profesor tiña ese rato reservado para ti. Non perdas o ritmo — retomamos esta semana?' },
  },
  asesoria: {
    es: { hook: 'Tu cita con la asesoría quedó libre', body: 'Teníamos ese rato para revisar tu situación. Mejor no dejarlo para el último día — ¿buscamos otro hueco?' },
    eu: { hook: 'Aholkularitzarekin zure hitzordua libre geratu da', body: 'Tarte hori zure egoera berrikusteko geneukan. Hobe ez azken egunerako uztea — beste tarte bat bilatzen dugu?' },
    gl: { hook: 'A túa cita coa asesoría quedou libre', body: 'Tiñamos ese rato para revisar a túa situación. Mellor non deixalo para o último día — buscamos outro oco?' },
  },
  abogados: {
    es: { hook: 'Tu cita con el despacho quedó libre', body: 'Reservamos ese tiempo para tratar tu asunto. Sabemos que surgen imprevistos — ¿buscamos otro momento esta semana?' },
    eu: { hook: 'Bulegoarekin zure hitzordua libre geratu da', body: 'Denbora hori zure gaia jorratzeko gorde genuen. Badakigu ezustekoak sortzen direla — beste une bat bilatzen dugu aste honetan?' },
    gl: { hook: 'A túa cita co despacho quedou libre', body: 'Reservamos ese tempo para tratar o teu asunto. Sabemos que xorden imprevistos — buscamos outro momento esta semana?' },
  },
  hotel: {
    es: { hook: 'Tu reserva quedó sin confirmar', body: 'Teníamos tu habitación lista. Si los planes cambiaron, lo entendemos — ¿reprogramamos tu estancia?' },
    eu: { hook: 'Zure erreserba berretsi gabe geratu da', body: 'Zure gela prest geneukan. Planak aldatu badira, ulertzen dugu — zure egonaldia berriz antolatzen dugu?' },
    gl: { hook: 'A túa reserva quedou sen confirmar', body: 'Tiñamos o teu cuarto listo. Se os plans cambiaron, enténdémolo — reprogramamos a túa estancia?' },
  },
  barberia: {
    es: { hook: 'Tu cita en la barbería quedó libre', body: 'Teníamos tu hueco reservado. Sin problema — ¿te buscamos otro rato esta semana?' },
    eu: { hook: 'Bizartegian zure hitzordua libre geratu da', body: 'Zure tartea gordeta geneukan. Arazorik gabe — beste tarte bat bilatzen dizugu aste honetan?' },
    gl: { hook: 'A túa cita na barbería quedou libre', body: 'Tiñamos o teu oco reservado. Sen problema — buscámosche outro rato esta semana?' },
  },
  default: {
    es: { hook: 'Vimos que no pudiste venir hoy', body: '¡No te preocupes! Pasan estas cosas. Si quieres, te buscamos otro hueco para que podamos atenderte.' },
    eu: { hook: 'Gaur ezin izan duzula etorri ikusi dugu', body: 'Ez kezkatu! Gertatzen da. Nahi baduzu, beste tarte bat bilatzen dizugu zu artatu ahal izateko.' },
    gl: { hook: 'Vimos que non puideches vir hoxe', body: 'Non te preocupes! Pasan estas cousas. Se queres, buscámosche outro oco para poder atenderte.' },
  },
};

function getNoShowCopy(sector, lang) {
  const s = NOSHOW_COPY[sector] || NOSHOW_COPY.default;
  const l = s[lang] || s.es || NOSHOW_COPY.default.es;
  return l;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * @param {object} apt    - { email, patientName, date, time, service, id, businessId }
 * @param {object} config - { name, ownerPhone, language, sector }
 */
async function sendNoShowEmail(apt, config) {
  if (!apt?.email) {
    log.warn(`sendNoShowEmail: no email for ${apt?.patientName} — skipped`);
    return false;
  }

  const lang      = config?.language || 'es';
  const sector    = config?.sector   || 'default';
  const sc        = SECTOR_CONFIG[sector] || SECTOR_CONFIG.default;
  const copy      = getNoShowCopy(sector, lang);
  const rawName   = firstName(apt.patientName);
  const name      = esc(rawName);
  const bizName   = esc(config?.name || 'nuestro equipo');
  const phone     = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');
  const service   = esc(apt.service || 'tu cita');

  // Format appointment datetime
  let aptStr = `${apt.date} a las ${apt.time}`;
  try {
    const d = new Date(`${apt.date}T${apt.time}:00`);
    aptStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    }) + ` a las ${apt.time}`;
  } catch(_) {}

  const greeting  = lang === 'eu' ? `Kaixo ${name}` : lang === 'gl' ? `Ola ${name}` : `Hola ${name}`;
  const ctaCall   = lang === 'eu' ? 'Deitu reagendatzeko' : lang === 'gl' ? 'Chamar para reagendar' : 'Llamar para reagendar';
  const ctaWa     = lang === 'eu' ? 'WhatsApp bidez' : 'Por WhatsApp';
  const serviceLabel = lang === 'eu' ? 'Zerbitzua' : lang === 'gl' ? 'Servizo' : 'Servicio';
  const dateLabel    = lang === 'eu' ? 'Eguna' : lang === 'gl' ? 'Data' : 'Fecha';
  const unsubLabel   = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : lang === 'gl'
    ? 'Para non recibir máis avisos, responde a este correo.'
    : 'Para darte de baja de estos avisos, responde a este email.';

  // WhatsApp deep link
  const waText = encodeURIComponent(lang === 'eu'
    ? `Kaixo, ${rawName} naiz. Hitzordua galdu nuen eta berrezarri nahi nuke.`
    : `Hola, soy ${rawName}. Se me pasó la cita y me gustaría reagendarla.`);
  const rawWaPhone = phone.replace(/\D/g, '');
  const waPhone = rawWaPhone.startsWith('34') || rawWaPhone.startsWith('0034') ? rawWaPhone : '34' + rawWaPhone;
  const waLink = phone ? `https://wa.me/${waPhone}?text=${waText}` : '';

  const subject = lang === 'eu'
    ? `${esc(config?.name || '')}: zure hitzordua — ${service}`
    : `${esc(config?.name || '')}: ${copy.hook}`;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f8;padding:32px 16px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

    <!-- HEADER -->
    <tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:22px 28px;border-bottom:3px solid ${sc.color};">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:17px;font-weight:900;color:#0f0f23;letter-spacing:-.03em;">${bizName}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">
              ${lang === 'eu' ? 'Hitzordua falta duzu' : lang === 'gl' ? 'Cita non atendida' : 'Cita no atendida'}
            </div>
          </td>
          <td align="right" style="font-size:32px;">${sc.emoji}</td>
        </tr>
      </table>
    </td></tr>

    <!-- BODY -->
    <tr><td style="background:#ffffff;padding:28px 28px 24px;">

      <!-- Hook title -->
      <p style="font-size:20px;font-weight:900;color:#0f0f23;margin:0 0 8px;letter-spacing:-.02em;">${esc(copy.hook)}</p>

      <!-- Greeting + body -->
      <p style="font-size:15px;color:#334155;margin:0 0 20px;line-height:1.7;">
        ${greeting}, ${esc(copy.body)}
      </p>

      <!-- Appointment box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${sc.light};border-left:4px solid ${sc.color};border-radius:0 10px 10px 0;margin:0 0 24px;">
        <tr><td style="padding:14px 18px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:${sc.dark};padding:3px 0;">
                <strong>${serviceLabel}:</strong> ${service}
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:${sc.dark};padding:3px 0;">
                <strong>${dateLabel}:</strong> ${esc(aptStr)}
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- CTAs -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${sc.color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${ctaCall}</a>
            </td></tr></table>
          </td>` : ''}
          ${waLink ? `<td>
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#25d366;">
              <a href="${waLink}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">💬 ${ctaWa}</a>
            </td></tr></table>
          </td>` : ''}
        </tr>
      </table>

    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:#f8f8fb;border-radius:0 0 16px 16px;padding:16px 28px;border-top:1px solid #e8e8f0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">${unsubLabel}</p>
      <p style="font-size:10px;color:#cbd5e1;margin:6px 0 0;">
        Gestionado por <a href="https://nodeflow.es" style="color:${sc.color};text-decoration:none;">NodeFlow IA</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${copy.hook}`,
    ``,
    `${greeting}, ${copy.body}`,
    ``,
    `${serviceLabel}: ${apt.service || 'tu cita'}`,
    `${dateLabel}: ${aptStr}`,
    ``,
    phone ? `📞 Llamar: ${phone}` : '',
    waLink ? `💬 WhatsApp: ${waLink}` : '',
    ``,
    unsubLabel,
  ].filter(Boolean).join('\n');

  log.info(`No-show email sent to ${apt.email} (apt:${apt.id}, biz:${apt.businessId}, sector:${sector})`);
  return sendEmail({ to: apt.email, subject, html, text });
}

module.exports = { sendNoShowEmail };
