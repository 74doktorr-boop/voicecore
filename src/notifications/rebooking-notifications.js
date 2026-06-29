// ============================================
// NodeFlow — Re-booking email v2
// Sector-aware, trilingual (es/eu/gl)
// ============================================
'use strict';

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('REBOOKING-NOTIF');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function firstName(n = '') { return n.split(' ')[0]; }

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
  hotel:        { emoji: '🏨', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  yoga:         { emoji: '🧘', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  pilates:      { emoji: '🏃', color: '#db2777', light: '#fdf2f8', dark: '#831843' },
  nutricion:    { emoji: '🥗', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  barberia:     { emoji: '💈', color: '#1e293b', light: '#f8fafc', dark: '#0f172a' },
  autoescuela:  { emoji: '🚗', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  abogados:     { emoji: '⚖️', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  podologia:        { emoji: '🦶', color: '#0d9488', light: '#f0fdfa', dark: '#134e4a' },
  spa:              { emoji: '🧖', color: '#0891b2', light: '#f0f9ff', dark: '#0c4a6e' },
  agencia_viajes:   { emoji: '✈️', color: '#0284c7', light: '#f0f9ff', dark: '#0c4a6e' },
  inmobiliaria:     { emoji: '🏡', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  coaching:         { emoji: '🎯', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  reformas:         { emoji: '🔨', color: '#b45309', light: '#fffbeb', dark: '#78350f' },
  guarderia_canina: { emoji: '🐶', color: '#d97706', light: '#fffbeb', dark: '#78350f' },
  default:      { emoji: '👋', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
};

// ─── Sector copy (title + body + stat) ───────────────────────────────────────

const SECTOR_COPY = {
  peluqueria: {
    es: {
      title: 'Tu melena te llama',
      body: 'Hace más de un mes que no pasas por aquí. ¿Reservamos para esta semana?',
      stat: { emoji: '✂️', value: '4-6 sem', label: 'Intervalo ideal\nentre visitas' },
    },
    eu: {
      title: 'Zure ileak dei egiten dizu',
      body: 'Hilabete baino gehiago da hemendik pasatu ez zarela. Aste honetarako hitzordua jartzen dugu?',
      stat: { emoji: '✂️', value: '4-6 aste', label: 'Bisita tartea\negokia' },
    },
    gl: {
      title: 'A túa melena chámate',
      body: 'Hai máis dun mes que non pasas por aquí. Reservamos para esta semana?',
      stat: { emoji: '✂️', value: '4-6 sem', label: 'Intervalo ideal\nentre visitas' },
    },
  },
  estetica: {
    es: {
      title: 'Es hora de mimarte',
      body: 'Hace tiempo que no disfrutas de tu tratamiento favorito. Tu piel lo nota.',
      stat: { emoji: '💆', value: '3-4 sem', label: 'Frecuencia ideal\npara mejores resultados' },
    },
    eu: {
      title: 'Zure burua zaintzeko garaia',
      body: 'Aspaldi ez duzu zure tratamendu gogokoena egin. Zure azalak nabaritzen du.',
      stat: { emoji: '💆', value: '3-4 aste', label: 'Maiztasun egokia\nemaitza hobeetarako' },
    },
    gl: {
      title: 'É hora de mimarte',
      body: 'Hai tempo que non gozas do teu tratamento favorito. A túa pel nótao.',
      stat: { emoji: '💆', value: '3-4 sem', label: 'Frecuencia ideal\npara mellores resultados' },
    },
  },
  dental: {
    es: {
      title: 'Tu revisión dental anual',
      body: 'Han pasado 6 meses desde tu última consulta. Una revisión preventiva ahorra mucho a largo plazo.',
      stat: { emoji: '🦷', value: '6 meses', label: 'Revisión recomendada\npor los expertos' },
    },
    eu: {
      title: 'Zure urteko hortz azterketa',
      body: '6 hilabete igaro dira azken kontsultatik. Azterketa prebentibo batek asko aurrezten du epe luzera.',
      stat: { emoji: '🦷', value: '6 hilabete', label: 'Adituek gomendatutako\nazterketa' },
    },
    gl: {
      title: 'A túa revisión dental anual',
      body: 'Pasaron 6 meses dende a túa última consulta. Unha revisión preventiva aforra moito a longo prazo.',
      stat: { emoji: '🦷', value: '6 meses', label: 'Revisión recomendada\npolos expertos' },
    },
  },
  clinica: {
    es: {
      title: 'Recordatorio de revisión',
      body: 'Han pasado varios meses desde tu última consulta. Tu salud es lo primero.',
      stat: { emoji: '🏥', value: '3-6 mes', label: 'Control médico\nrecomendado' },
    },
    eu: {
      title: 'Azterketa gogorarazpena',
      body: 'Hilabete batzuk igaro dira azken kontsultatik. Zure osasuna lehenengoa da.',
      stat: { emoji: '🏥', value: '3-6 hil', label: 'Gomendatutako\nkontrol medikoa' },
    },
    gl: {
      title: 'Recordatorio de revisión',
      body: 'Pasaron varios meses dende a túa última consulta. A túa saúde é o primeiro.',
      stat: { emoji: '🏥', value: '3-6 mes', label: 'Control médico\nrecomendado' },
    },
  },
  veterinaria: {
    es: {
      title: 'Tu mascota merece una revisión',
      body: 'Ha pasado un año desde la última visita. Una revisión anual es clave para su salud.',
      stat: { emoji: '🐾', value: '1 año', label: 'Revisión anual\nrecomendada' },
    },
    eu: {
      title: 'Zure maskotak azterketa bat merezi du',
      body: 'Urte bat igaro da azken bisitaz geroztik. Urteko azterketa funtsezkoa da bere osasunerako.',
      stat: { emoji: '🐾', value: '1 urte', label: 'Urteko azterketa\ngomendatua' },
    },
    gl: {
      title: 'A túa mascota merece unha revisión',
      body: 'Pasou un ano dende a última visita. Unha revisión anual é clave para a súa saúde.',
      stat: { emoji: '🐾', value: '1 ano', label: 'Revisión anual\nrecomendada' },
    },
  },
  taller: {
    es: {
      title: 'Tu coche lleva tiempo sin revisión',
      body: 'Hace un año desde la última puesta a punto. Mejor revisarlo antes de que avise en marcha.',
      stat: { emoji: '🚗', value: '1 año', label: 'Revisión anual\nrecomendada' },
    },
    eu: {
      title: 'Zure autoak aspaldi ez du azterketarik',
      body: 'Urtebete igaro da azken puntara-jartzetik. Hobe da gidatzean abisatu baino lehen berrikustea.',
      stat: { emoji: '🚗', value: '1 urte', label: 'Urteko azterketa\ngomendatua' },
    },
    gl: {
      title: 'O teu coche leva tempo sen revisión',
      body: 'Hai un ano dende a última posta a punto. Mellor revisalo antes de que avise en marcha.',
      stat: { emoji: '🚗', value: '1 ano', label: 'Revisión anual\nrecomendada' },
    },
  },
  gimnasio: {
    es: {
      title: '¡Te echamos de menos!',
      body: 'Llevamos tiempo sin verte. La constancia es lo que marca la diferencia — volvemos a estar aquí.',
      stat: { emoji: '💪', value: '3x/sem', label: 'Frecuencia ideal\npara resultados' },
    },
    eu: {
      title: 'Faltan zaitugu!',
      body: 'Aspaldi ez zaitugu ikusi. Iraunkortasunak egiten du aldea — hemen gaude berriro.',
      stat: { emoji: '💪', value: '3x/aste', label: 'Emaitzetarako\nmaiztasun egokia' },
    },
    gl: {
      title: 'Botámoste de menos!',
      body: 'Levamos tempo sen verte. A constancia é o que marca a diferenza — volvemos estar aquí.',
      stat: { emoji: '💪', value: '3x/sem', label: 'Frecuencia ideal\npara resultados' },
    },
  },
  fisioterapia: {
    es: {
      title: 'Seguimiento de tu tratamiento',
      body: 'Los tratamientos de fisio funcionan mucho mejor cuando se mantiene la cadencia. ¿Continuamos?',
      stat: { emoji: '🏃', value: '1-2 sem', label: 'Frecuencia recomendada\nentre sesiones' },
    },
    eu: {
      title: 'Zure tratamenduaren jarraipena',
      body: 'Fisioterapia tratamenduek askoz hobeto funtzionatzen dute erritmoari eutsiz gero. Jarraitzen dugu?',
      stat: { emoji: '🏃', value: '1-2 aste', label: 'Saioen arteko\nmaiztasun gomendatua' },
    },
    gl: {
      title: 'Seguimento do teu tratamento',
      body: 'Os tratamentos de fisio funcionan moito mellor cando se mantén a cadencia. Continuamos?',
      stat: { emoji: '🏃', value: '1-2 sem', label: 'Frecuencia recomendada\nentre sesións' },
    },
  },
  restaurante: {
    es: {
      title: '¿Volvemos a vernos?',
      body: 'Han pasado unas semanas desde tu última visita. Tenemos novedades en carta que te van a gustar.',
      stat: { emoji: '🍽️', value: 'Nuevo menú', label: 'Novedades desde\ntu última visita' },
    },
    eu: {
      title: 'Berriro elkar ikusiko dugu?',
      body: 'Aste batzuk igaro dira azken bisitatik. Kartan berritasunak ditugu, gustatuko zaizkizunak.',
      stat: { emoji: '🍽️', value: 'Menu berria', label: 'Berritasunak zure\nazken bisitatik' },
    },
    gl: {
      title: 'Volvémonos a ver?',
      body: 'Pasaron unhas semanas dende a túa última visita. Temos novidades na carta que che van gustar.',
      stat: { emoji: '🍽️', value: 'Novo menú', label: 'Novidades dende\na túa última visita' },
    },
  },
  psicologia: {
    es: {
      title: '¿Cómo estás?',
      body: 'Hace unas semanas que no hablamos. Estoy aquí cuando lo necesites — sin prisas ni presión.',
      stat: { emoji: '🧠', value: 'Semanal', label: 'Cadencia recomendada\nen proceso activo' },
    },
    eu: {
      title: 'Zer moduz zaude?',
      body: 'Aste batzuk dira hitz egin ez dugula. Hemen nago behar duzunean — presarik eta presiorik gabe.',
      stat: { emoji: '🧠', value: 'Astero', label: 'Prozesu aktiboan\ngomendatutako erritmoa' },
    },
    gl: {
      title: 'Como estás?',
      body: 'Hai unhas semanas que non falamos. Estou aquí cando o precises — sen presas nin presión.',
      stat: { emoji: '🧠', value: 'Semanal', label: 'Cadencia recomendada\nen proceso activo' },
    },
  },
  nutricion: {
    es: {
      title: 'Tu seguimiento mensual te espera',
      body: 'Es el momento de revisar tu progreso. Un seguimiento constante marca la diferencia.',
      stat: { emoji: '🥗', value: '1 mes', label: 'Control mensual\nrecomendado' },
    },
    eu: {
      title: 'Zure hileroko jarraipena zain',
      body: 'Zure aurrerapena berrikusteko unea da. Jarraipen iraunkorrak egiten du aldea.',
      stat: { emoji: '🥗', value: '1 hil', label: 'Gomendatutako\nhileroko kontrola' },
    },
    gl: {
      title: 'O teu seguimento mensual espérate',
      body: 'É o momento de revisar o teu progreso. Un seguimento constante marca a diferenza.',
      stat: { emoji: '🥗', value: '1 mes', label: 'Control mensual\nrecomendado' },
    },
  },
  yoga: {
    es: {
      title: 'El mat te echa de menos',
      body: 'Hace unas semanas que no practicas. La constancia en el yoga es donde están los resultados.',
      stat: { emoji: '🧘', value: '2-3x/sem', label: 'Práctica ideal\npara progresar' },
    },
    eu: {
      title: 'Matak faltan zaitu',
      body: 'Aste batzuk dira praktikatu ez duzula. Yogan iraunkortasunean daude emaitzak.',
      stat: { emoji: '🧘', value: '2-3x/aste', label: 'Aurreratzeko\npraktika egokia' },
    },
    gl: {
      title: 'O mat bótate de menos',
      body: 'Hai unhas semanas que non practicas. A constancia no yoga é onde están os resultados.',
      stat: { emoji: '🧘', value: '2-3x/sem', label: 'Práctica ideal\npara progresar' },
    },
  },
  pilates: {
    es: {
      title: 'Retomemos el pilates',
      body: 'Tu cuerpo mejora con la constancia. ¿Reservamos una clase para esta semana?',
      stat: { emoji: '🏃', value: '2x/sem', label: 'Frecuencia ideal\nen pilates' },
    },
    eu: {
      title: 'Berriz hasi gaitezen pilatesarekin',
      body: 'Zure gorputza hobetu egiten da iraunkortasunarekin. Aste honetarako klase bat hartzen dugu?',
      stat: { emoji: '🏃', value: '2x/aste', label: 'Pilatesean\nmaiztasun egokia' },
    },
    gl: {
      title: 'Retomemos o pilates',
      body: 'O teu corpo mellora coa constancia. Reservamos unha clase para esta semana?',
      stat: { emoji: '🏃', value: '2x/sem', label: 'Frecuencia ideal\nen pilates' },
    },
  },
  barberia: {
    es: {
      title: 'Ya va tocando un repaso',
      body: 'Llevamos un tiempo sin verte por la barbería. ¿Te apuntamos para esta semana?',
      stat: { emoji: '💈', value: '3-4 sem', label: 'Frecuencia ideal\nentre cortes' },
    },
    eu: {
      title: 'Errepasoa egiteko garaia',
      body: 'Aspaldi ez zaitugu ikusi bizartegian. Aste honetarako apuntatzen zaitugu?',
      stat: { emoji: '💈', value: '3-4 aste', label: 'Mozketen arteko\nmaiztasun egokia' },
    },
    gl: {
      title: 'Xa vai tocando un repaso',
      body: 'Levamos un tempo sen verte pola barbería. Apuntámoste para esta semana?',
      stat: { emoji: '💈', value: '3-4 sem', label: 'Frecuencia ideal\nentre cortes' },
    },
  },
  optica: {
    es: {
      title: 'Tu vista merece atención',
      body: 'Hace tiempo que no revisamos tu graduación. Una revisión periódica es clave para tu salud visual.',
      stat: { emoji: '👓', value: '1-2 años', label: 'Revisión visual\nrecomendada' },
    },
    eu: {
      title: 'Zure ikusmenak arreta merezi du',
      body: 'Aspaldi ez dugu zure graduazioa berrikusi. Aldizkako azterketa giltzarria da zure ikusmen-osasunerako.',
      stat: { emoji: '👓', value: '1-2 urte', label: 'Ikusmen azterketa\ngomendatua' },
    },
    gl: {
      title: 'A túa vista merece atención',
      body: 'Hai tempo que non revisamos a túa graduación. Unha revisión periódica é clave para a túa saúde visual.',
      stat: { emoji: '👓', value: '1-2 anos', label: 'Revisión visual\nrecomendada' },
    },
  },
  asesoria: {
    es: {
      title: 'Se acerca el próximo período fiscal',
      body: 'Llevamos unos meses sin hablar. ¿Revisamos tu situación antes del próximo vencimiento?',
      stat: { emoji: '📊', value: 'Trimestral', label: 'Revisión contable\nrecomendada' },
    },
    eu: {
      title: 'Hurrengo zerga-aldia hurbiltzen ari da',
      body: 'Hilabete batzuk dira hitz egin ez dugula. Zure egoera berrikusten dugu hurrengo epemuga baino lehen?',
      stat: { emoji: '📊', value: 'Hiruhileko', label: 'Gomendatutako\nkontabilitate azterketa' },
    },
    gl: {
      title: 'Achégase o próximo período fiscal',
      body: 'Levamos uns meses sen falar. Revisamos a túa situación antes do próximo vencemento?',
      stat: { emoji: '📊', value: 'Trimestral', label: 'Revisión contable\nrecomendada' },
    },
  },
  hotel: {
    es: {
      title: '¿Vuelves a visitarnos?',
      body: 'Han pasado unos meses desde tu estancia. Tenemos una oferta especial para clientes habituales.',
      stat: { emoji: '🏨', value: 'Oferta', label: 'Descuento exclusivo\npara clientes frecuentes' },
    },
    eu: {
      title: 'Berriro bisitatuko gaituzu?',
      body: 'Hilabete batzuk igaro dira zure egonalditik. Bezero ohientzako eskaintza berezia dugu.',
      stat: { emoji: '🏨', value: 'Eskaintza', label: 'Bezero ohientzako\ndeskontu esklusiboa' },
    },
    gl: {
      title: 'Volves visitarnos?',
      body: 'Pasaron uns meses dende a túa estancia. Temos unha oferta especial para clientes habituais.',
      stat: { emoji: '🏨', value: 'Oferta', label: 'Desconto exclusivo\npara clientes frecuentes' },
    },
  },
  academia: {
    es: {
      title: 'No te pierdas las próximas clases',
      body: 'Hay plazas disponibles en los próximos cursos. ¿Te interesa continuar con tu formación?',
      stat: { emoji: '📚', value: 'Nuevos cursos', label: 'Disponibles\neste mes' },
    },
    eu: {
      title: 'Ez galdu hurrengo klaseak',
      body: 'Hurrengo ikastaroetan plazak daude. Zure prestakuntzarekin jarraitu nahi duzu?',
      stat: { emoji: '📚', value: 'Ikastaro berriak', label: 'Hilabete honetan\neskuragarri' },
    },
    gl: {
      title: 'Non perdas as próximas clases',
      body: 'Hai prazas dispoñibles nos próximos cursos. Interésache continuar coa túa formación?',
      stat: { emoji: '📚', value: 'Novos cursos', label: 'Dispoñibles\neste mes' },
    },
  },
  farmacia: {
    es: {
      title: 'Renovación de medicación',
      body: 'Es momento de renovar tu receta o pasar a recoger tu pedido habitual.',
      stat: { emoji: '💊', value: 'Mensual', label: 'Renovación\nde medicación' },
    },
    eu: {
      title: 'Botiken berritzea',
      body: 'Zure errezeta berritzeko edo ohiko eskaera jasotzeko garaia da.',
      stat: { emoji: '💊', value: 'Hilero', label: 'Botiken\nberritzea' },
    },
    gl: {
      title: 'Renovación de medicación',
      body: 'É momento de renovar a túa receita ou pasar a recoller o teu pedido habitual.',
      stat: { emoji: '💊', value: 'Mensual', label: 'Renovación\nde medicación' },
    },
  },
  abogados: {
    es: {
      title: 'Revisemos tu situación',
      body: 'Han pasado unos meses. ¿Hay algo legal que deba revisar o gestionar para ti?',
      stat: { emoji: '⚖️', value: 'Periódico', label: 'Revisión de\nasuntos legales' },
    },
    eu: {
      title: 'Berrikus dezagun zure egoera',
      body: 'Hilabete batzuk igaro dira. Berrikusi edo kudeatu beharreko gairik bada zuretzat?',
      stat: { emoji: '⚖️', value: 'Aldizka', label: 'Gai juridikoen\nberrikuspena' },
    },
    gl: {
      title: 'Revisemos a túa situación',
      body: 'Pasaron uns meses. Hai algo legal que deba revisar ou xestionar para ti?',
      stat: { emoji: '⚖️', value: 'Periódico', label: 'Revisión de\nasuntos legais' },
    },
  },
  podologia: {
    es: {
      title: 'Tu revisión podológica',
      body: 'Hace tiempo que no cuidamos tus pies. Una revisión periódica previene molestias mayores.',
      stat: { emoji: '🦶', value: '1-2 mes', label: 'Revisión periódica\nrecomendada' },
    },
    eu: {
      title: 'Zure podologia azterketa',
      body: 'Aspaldi ez ditugu zure oinak zaindu. Aldizkako azterketak arazo handiagoak saihesten ditu.',
      stat: { emoji: '🦶', value: '1-2 hil', label: 'Aldizkako azterketa\ngomendatua' },
    },
    gl: {
      title: 'A túa revisión podolóxica',
      body: 'Hai tempo que non coidamos os teus pés. Unha revisión periódica prevén molestias maiores.',
      stat: { emoji: '🦶', value: '1-2 mes', label: 'Revisión periódica\nrecomendada' },
    },
  },
  spa: {
    es: {
      title: 'Un respiro te está esperando',
      body: 'Hace tiempo que no te regalas un momento de relax. Tu cuerpo y tu mente lo agradecerán.',
      stat: { emoji: '🧖', value: 'Mensual', label: 'Frecuencia ideal\npara desconectar' },
    },
    eu: {
      title: 'Atseden hartzeko unea zain duzu',
      body: 'Aspaldi ez diozu zeure buruari erlaxatzeko unerik oparitu. Zure gorputzak eta buruak eskertuko dute.',
      stat: { emoji: '🧖', value: 'Hilero', label: 'Deskonektatzeko\nmaiztasun egokia' },
    },
    gl: {
      title: 'Un respiro te está agardando',
      body: 'Hai tempo que non te agasallas cun momento de relax. O teu corpo e a túa mente agradeceranllo.',
      stat: { emoji: '🧖', value: 'Mensual', label: 'Frecuencia ideal\npara desconectar' },
    },
  },
  agencia_viajes: {
    es: {
      title: '¿Listo para tu próximo viaje?',
      body: 'Hace tiempo que no planificamos juntos una escapada. Tenemos novedades que te van a encantar.',
      stat: { emoji: '✈️', value: 'Novedades', label: 'Destinos y ofertas\nnuevas' },
    },
    eu: {
      title: 'Prest zure hurrengo bidaiarako?',
      body: 'Aspaldi ez dugu elkarrekin ihesaldirik antolatu. Gustatuko zaizkizun berritasunak ditugu.',
      stat: { emoji: '✈️', value: 'Berritasunak', label: 'Helmuga eta eskaintza\nberriak' },
    },
    gl: {
      title: 'Listo para a túa próxima viaxe?',
      body: 'Hai tempo que non planificamos xuntos unha escapada. Temos novidades que che van encantar.',
      stat: { emoji: '✈️', value: 'Novidades', label: 'Destinos e ofertas\nnovas' },
    },
  },
  inmobiliaria: {
    es: {
      title: '¿Seguimos con tu búsqueda?',
      body: 'Hace tiempo que no hablamos de tu operación. Han salido propiedades nuevas que encajan contigo.',
      stat: { emoji: '🏡', value: 'Nuevas', label: 'Propiedades que\nencajan contigo' },
    },
    eu: {
      title: 'Zure bilaketarekin jarraitzen dugu?',
      body: 'Aspaldi ez dugu zure eragiketaz hitz egin. Zurekin bat datozen jabetza berriak atera dira.',
      stat: { emoji: '🏡', value: 'Berriak', label: 'Zurekin bat datozen\njabetzak' },
    },
    gl: {
      title: 'Seguimos coa túa busca?',
      body: 'Hai tempo que non falamos da túa operación. Saíron propiedades novas que encaixan contigo.',
      stat: { emoji: '🏡', value: 'Novas', label: 'Propiedades que\nencaixan contigo' },
    },
  },
  coaching: {
    es: {
      title: 'Tu próximo paso te espera',
      body: 'Hace unas semanas que no avanzamos juntos en tus objetivos. ¿Retomamos donde lo dejamos?',
      stat: { emoji: '🎯', value: 'Continuidad', label: 'Clave para alcanzar\ntus metas' },
    },
    eu: {
      title: 'Zure hurrengo urratsa zain duzu',
      body: 'Aste batzuk dira zure helburuetan elkarrekin aurreratu ez dugula. Utzi genuen tokitik jarraitzen dugu?',
      stat: { emoji: '🎯', value: 'Jarraitasuna', label: 'Zure helburuak lortzeko\nfuntsezkoa' },
    },
    gl: {
      title: 'O teu próximo paso agárdate',
      body: 'Hai unhas semanas que non avanzamos xuntos nos teus obxectivos. Retomamos onde o deixamos?',
      stat: { emoji: '🎯', value: 'Continuidade', label: 'Clave para acadar\nas túas metas' },
    },
  },
  reformas: {
    es: {
      title: '¿Retomamos tu proyecto?',
      body: 'Hace tiempo que hablamos de tu reforma. Si sigues dándole vueltas, te preparamos un presupuesto sin compromiso.',
      stat: { emoji: '🔨', value: 'Presupuesto', label: 'Sin compromiso\ny a tu medida' },
    },
    eu: {
      title: 'Zure proiektua berriz hartzen dugu?',
      body: 'Aspaldi hitz egin genuen zure erreformaz. Oraindik bueltaka bazabiltza, konpromisorik gabeko aurrekontua prestatzen dizugu.',
      stat: { emoji: '🔨', value: 'Aurrekontua', label: 'Konpromisorik gabe\neta zure neurrira' },
    },
    gl: {
      title: 'Retomamos o teu proxecto?',
      body: 'Hai tempo que falamos da túa reforma. Se segues dándolle voltas, preparámosche un orzamento sen compromiso.',
      stat: { emoji: '🔨', value: 'Orzamento', label: 'Sen compromiso\ne á túa medida' },
    },
  },
  guarderia_canina: {
    es: {
      title: 'Tu peludo te echa de menos',
      body: 'Hace tiempo que no nos visita. Tenemos plazas disponibles cuando necesites dejarlo en buenas manos.',
      stat: { emoji: '🐶', value: 'Plazas', label: 'Disponibles\ncuando lo necesites' },
    },
    eu: {
      title: 'Zure txakurrak faltan zaitu',
      body: 'Aspaldi ez gaitu bisitatu. Plazak ditugu eskuragarri esku onetan utzi behar duzunean.',
      stat: { emoji: '🐶', value: 'Plazak', label: 'Behar duzunean\neskuragarri' },
    },
    gl: {
      title: 'O teu peludo bótate de menos',
      body: 'Hai tempo que non nos visita. Temos prazas dispoñibles cando precises deixalo en boas mans.',
      stat: { emoji: '🐶', value: 'Prazas', label: 'Dispoñibles\ncando o precises' },
    },
  },
  autoescuela: {
    es: {
      title: 'No dejes tu carnet a medias',
      body: 'Hace tiempo que no vienes a clase. Cuanto más constante, antes apruebas. ¿Retomamos esta semana?',
      stat: { emoji: '🚗', value: 'Constancia', label: 'Clave para aprobar\nantes' },
    },
    eu: {
      title: 'Ez utzi zure gidabaimena erdizka',
      body: 'Aspaldi ez zara klasera etorri. Zenbat eta konstanteago, lehenago gainditzen duzu. Aste honetan berriz hasten gara?',
      stat: { emoji: '🚗', value: 'Konstantzia', label: 'Lehenago gainditzeko\ngiltza' },
    },
    gl: {
      title: 'Non deixes o teu carné a medias',
      body: 'Hai tempo que non vés a clase. Canto máis constante, antes aprobas. Retomamos esta semana?',
      stat: { emoji: '🚗', value: 'Constancia', label: 'Clave para aprobar\nantes' },
    },
  },
  default: {
    es: {
      title: 'Hace tiempo que no te vemos',
      body: 'Queremos recordarte que seguimos aquí para ayudarte cuando lo necesites.',
      stat: { emoji: '👋', value: '¡Hola!', label: 'Seguimos aquí\npara ti' },
    },
    eu: {
      title: 'Denbora da ikusi ez zaitugula',
      body: 'Gogorarazi nahi dizugu hemen gaudela behar duzunean laguntzeko.',
      stat: { emoji: '👋', value: 'Kaixo!', label: 'Hemen gaude\nzure zain' },
    },
    gl: {
      title: 'Hai tempo que non te vemos',
      body: 'Queremos lembrarche que seguimos aquí para axudarche cando o precises.',
      stat: { emoji: '👋', value: 'Ola!', label: 'Seguimos aquí\npara ti' },
    },
  },
};

function getCopy(sector, lang) {
  const s = SECTOR_COPY[sector] || SECTOR_COPY.default;
  const l = s[lang] || s.es || SECTOR_COPY.default.es;
  return l;
}

// ─── Helper: stat box ─────────────────────────────────────────────────────────

function statBox(stat, color, light, dark) {
  if (!stat) return '';
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${light};border-radius:12px;margin:0 0 20px;">
    <tr>
      <td style="padding:16px 20px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:28px;padding-right:16px;vertical-align:middle;">${stat.emoji}</td>
            <td style="vertical-align:middle;">
              <div style="font-size:22px;font-weight:900;color:#0f0f23;letter-spacing:-.03em;">${esc(stat.value)}</div>
              <div style="font-size:11px;color:${dark};margin-top:2px;line-height:1.4;">${esc(stat.label).replace(/\n/g,'<br>')}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * @param {object} client        - { name, email, phone, lastVisitDate }
 * @param {object} config        - { name, ownerPhone, language, sector }
 * @param {string} lastVisitDate - 'YYYY-MM-DD'
 */
async function sendRebookingEmail(client, config, lastVisitDate) {
  if (!client?.email) {
    log.warn(`sendRebookingEmail: no email for client ${client?.name} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const sector  = config?.sector   || 'default';
  const sc      = SECTOR_CONFIG[sector] || SECTOR_CONFIG.default;
  const copy    = getCopy(sector, lang);
  const name    = firstName(client.name);
  const bizName = esc(config?.name || 'nuestro negocio');
  const phone   = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');

  // Format last visit date
  let lastVisitStr = lastVisitDate || '';
  if (lastVisitDate) {
    try {
      const d = new Date(lastVisitDate + 'T12:00:00');
      lastVisitStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch(_) {}
  }

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;
  const lastVisitLabel = lang === 'eu' ? 'Azken bisita' : 'Última visita';
  const ctaLabel  = lang === 'eu' ? 'Hitzordua hartu →' : lang === 'gl' ? 'Reservar cita →' : 'Reservar cita →';
  const ctaWa     = lang === 'eu' ? 'WhatsApp bidez' : 'Por WhatsApp';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : lang === 'gl'
    ? 'Para non recibir máis recordatorios, responde a este correo.'
    : 'Para darte de baja de estos recordatorios, responde a este email.';

  const waText = encodeURIComponent(lang === 'eu'
    ? `Kaixo, ${name} naiz. Hitzordua hartu nahi nuke.`
    : `Hola, soy ${name}. Me gustaría reservar una cita.`);
  const waLink = phone ? `https://wa.me/34${phone.replace(/\D/g,'')}?text=${waText}` : '';

  const subject = `${copy.title} — ${config?.name || ''}`;

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
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Mensaje del negocio</div>
          </td>
          <td align="right" style="font-size:32px;">${sc.emoji}</td>
        </tr>
      </table>
    </td></tr>

    <!-- BODY -->
    <tr><td style="background:#ffffff;padding:28px 28px 24px;">

      <!-- Title -->
      <p style="font-size:22px;font-weight:900;color:#0f0f23;margin:0 0 8px;letter-spacing:-.02em;">${esc(copy.title)}</p>

      <!-- Body text -->
      <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 20px;">
        ${greeting}, ${esc(copy.body)}
      </p>

      <!-- Stat box -->
      ${statBox(copy.stat, sc.color, sc.light, sc.dark)}

      <!-- Last visit (if provided) -->
      ${lastVisitStr ? `
      <div style="background:#f8f8fb;border-radius:10px;padding:12px 16px;margin:0 0 20px;font-size:13px;color:#64748b;">
        ${lastVisitLabel}: <strong style="color:#0f0f23;">${lastVisitStr}</strong>
      </div>` : ''}

      <!-- CTAs -->
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${sc.color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${ctaLabel}</a>
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
    `${copy.title}`,
    ``,
    `${greeting}, ${copy.body}`,
    ``,
    lastVisitStr ? `${lastVisitLabel}: ${lastVisitStr}` : '',
    ``,
    phone ? `📞 ${ctaLabel}: ${phone}` : '',
    waLink ? `💬 ${ctaWa}: ${waLink}` : '',
    ``,
    unsubLabel,
  ].filter(l => l !== undefined && l !== null).join('\n');

  log.info(`Sending rebooking email to ${client.email} (${sector}/${lang})`);
  return sendEmail({ to: client.email, subject, html, text });
}

// ─── Second-touch follow-up ───────────────────────────────────────────────────

/**
 * @param {object} client  - { name, email, phone }
 * @param {object} config  - { name, ownerPhone, language, sector }
 */
async function sendRebookingFollowUp(client, config) {
  if (!client?.email) {
    log.warn(`sendRebookingFollowUp: no email for ${client?.name} — skipped`);
    return false;
  }

  const lang      = config?.language || 'es';
  const sector    = config?.sector   || 'default';
  const sc        = SECTOR_CONFIG[sector] || SECTOR_CONFIG.default;
  const rawName   = firstName(client.name);
  const name      = esc(rawName);
  const bizName   = esc(config?.name || 'nuestro equipo');
  const phone     = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');

  // Second touch is more personal — shorter, different angle
  const FOLLOWUP_COPY = {
    peluqueria: {
      es: { title: 'Un mensaje rápido de tu peluquería', body: 'Solo quería ver si necesitas hora esta semana. Tenemos huecos disponibles — reservar lleva 30 segundos.' },
      eu: { title: 'Mezu azkar bat zure ile-apaindegitik', body: 'Aste honetarako ordua behar duzun ikusi nahi nuen. Tarteak libre daude — hitzordua hartzeak 30 segundo besterik ez du.' },
      gl: { title: 'Unha mensaxe rápida da túa perruquería', body: 'Só quería ver se precisas hora esta semana. Temos ocos dispoñibles — reservar leva 30 segundos.' },
    },
    estetica: {
      es: { title: 'Tu hueco sigue disponible', body: 'Sin agobios — solo recordarte que tu tratamiento te espera cuando quieras. Reservar es muy rápido.' },
      eu: { title: 'Zure tartea libre dago oraindik', body: 'Estresik gabe — gogorarazi nahi nizun zure tratamendua zain duzula nahi duzunean. Hitzordua hartzea oso azkarra da.' },
      gl: { title: 'O teu oco segue dispoñible', body: 'Sen agobios — só lembrarte que o teu tratamento te espera cando queiras. Reservar é moi rápido.' },
    },
    dental: {
      es: { title: 'Solo un recordatorio amable', body: 'La revisión dental sigue pendiente. Cuanto antes, mejor para tu salud bucal. ¿Lo dejamos esta semana?' },
      eu: { title: 'Gogorarazpen atsegin bat besterik ez', body: 'Hortz azterketa zain dago oraindik. Zenbat eta lehenago, hobe zure aho-osasunerako. Aste honetan uzten dugu?' },
      gl: { title: 'Só un recordatorio amable', body: 'A revisión dental segue pendente. Canto antes, mellor para a túa saúde bucal. Deixámolo esta semana?' },
    },
    clinica: {
      es: { title: 'Tu salud no puede esperar', body: 'Te escribimos hace unos días sobre tu revisión. Sigue siendo buen momento para reservarla. ¿Te ayudamos?' },
      eu: { title: 'Zure osasunak ezin du itxaron', body: 'Duela egun batzuk idatzi genizun zure azterketari buruz. Oraindik une ona da hura hartzeko. Laguntzen dizugu?' },
      gl: { title: 'A túa saúde non pode agardar', body: 'Escribímosche hai uns días sobre a túa revisión. Segue sendo bo momento para reservala. Axudámoste?' },
    },
    veterinaria: {
      es: { title: 'La salud de tu mascota es lo primero', body: 'Solo recordarte que su revisión sigue pendiente. Cuando os venga bien, aquí estamos.' },
      eu: { title: 'Zure maskotaren osasuna lehenengoa da', body: 'Gogorarazi nahi nizun bere azterketa zain dagoela oraindik. Ondo datorkizuenean, hemen gaude.' },
      gl: { title: 'A saúde da túa mascota é o primeiro', body: 'Só lembrarte que a súa revisión segue pendente. Cando vos veña ben, aquí estamos.' },
    },
    taller: {
      es: { title: 'Tu coche sigue pendiente de revisión', body: 'Te escribimos hace unos días. La cita sigue en pie cuando quieras traerlo — sin compromiso.' },
      eu: { title: 'Zure autoa azterketaren zain dago oraindik', body: 'Duela egun batzuk idatzi genizun. Hitzordua zutik dago ekarri nahi duzunean — konpromisorik gabe.' },
      gl: { title: 'O teu coche segue pendente de revisión', body: 'Escribímosche hai uns días. A cita segue en pé cando queiras traelo — sen compromiso.' },
    },
    gimnasio: {
      es: { title: 'Tu sitio te sigue esperando', body: 'Volver es más fácil de lo que parece. Cuando quieras retomar, tu plaza está aquí.' },
      eu: { title: 'Zure lekuak zain jarraitzen du', body: 'Itzultzea dirudiena baino errazagoa da. Berriz hasi nahi duzunean, zure plaza hemen dago.' },
      gl: { title: 'O teu sitio segue agardándote', body: 'Volver é máis fácil do que parece. Cando queiras retomar, a túa praza está aquí.' },
    },
    fisioterapia: {
      es: { title: 'No dejes tu tratamiento a medias', body: 'Los resultados llegan con la continuidad. Tu próxima sesión te espera cuando quieras retomarla.' },
      eu: { title: 'Ez utzi zure tratamendua erdizka', body: 'Emaitzak jarraitasunarekin iristen dira. Zure hurrengo saioa zain duzu berriz hasi nahi duzunean.' },
      gl: { title: 'Non deixes o teu tratamento a medias', body: 'Os resultados chegan coa continuidade. A túa próxima sesión espérate cando queiras retomala.' },
    },
    restaurante: {
      es: { title: 'Vuestra mesa os espera', body: 'Por si os apetece repetir — seguimos aquí con las mismas ganas. Reservar lleva un momento.' },
      eu: { title: 'Zuen mahaia zain duzue', body: 'Errepikatzeko gogoa baduzue — hemen jarraitzen dugu gogo berberarekin. Erreserbatzeak une bat besterik ez du.' },
      gl: { title: 'A vosa mesa agárdavos', body: 'Por se vos apetece repetir — seguimos aquí coas mesmas ganas. Reservar leva un momento.' },
    },
    psicologia: {
      es: { title: '¿Cómo llevas la semana?', body: 'No hace falta que todo esté bien para hablar. Estoy aquí cuando quieras retomar.' },
      eu: { title: 'Zer moduz daramazu astea?', body: 'Ez da beharrezkoa dena ondo egotea hitz egiteko. Hemen nago berriz hasi nahi duzunean.' },
      gl: { title: 'Como levas a semana?', body: 'Non fai falta que todo estea ben para falar. Estou aquí cando queiras retomar.' },
    },
    nutricion: {
      es: { title: 'Tu progreso merece seguimiento', body: 'Un pequeño paso esta semana marca la diferencia. ¿Retomamos tu control cuando te venga bien?' },
      eu: { title: 'Zure aurrerapenak jarraipena merezi du', body: 'Aste honetako urrats txiki batek aldea egiten du. Zure kontrola berriz hartzen dugu ondo datorkizunean?' },
      gl: { title: 'O teu progreso merece seguimento', body: 'Un pequeno paso esta semana marca a diferenza. Retomamos o teu control cando che veña ben?' },
    },
    yoga: {
      es: { title: 'El mat te sigue esperando', body: 'Una clase es suficiente para reconectar. Cuando quieras volver, aquí estamos.' },
      eu: { title: 'Matak zain jarraitzen zaitu', body: 'Klase bat nahikoa da berriz konektatzeko. Itzuli nahi duzunean, hemen gaude.' },
      gl: { title: 'O mat segue agardándote', body: 'Unha clase é suficiente para reconectar. Cando queiras volver, aquí estamos.' },
    },
    pilates: {
      es: { title: 'Retomar es más fácil de lo que crees', body: 'Tu cuerpo lo nota desde la primera clase. ¿Reservamos una esta semana?' },
      eu: { title: 'Berriz hastea uste duzuna baino errazagoa da', body: 'Zure gorputzak lehen klasetik nabaritzen du. Bat hartzen dugu aste honetan?' },
      gl: { title: 'Retomar é máis fácil do que cres', body: 'O teu corpo nótao dende a primeira clase. Reservamos unha esta semana?' },
    },
    barberia: {
      es: { title: 'Toca repaso', body: 'Solo recordarte que tu hueco está disponible esta semana. Reservar lleva nada.' },
      eu: { title: 'Errepasoa egiteko garaia', body: 'Gogorarazi nahi nizun zure tartea aste honetan libre dagoela. Hitzordua hartzea berehalakoa da.' },
      gl: { title: 'Toca repaso', body: 'Só lembrarte que o teu oco está dispoñible esta semana. Reservar leva nada.' },
    },
    optica: {
      es: { title: 'Tu revisión visual sigue pendiente', body: 'Cuidar tu vista es rápido y sencillo. Cuando quieras, te reservamos la revisión.' },
      eu: { title: 'Zure ikusmen azterketa zain dago oraindik', body: 'Zure ikusmena zaintzea azkarra eta erraza da. Nahi duzunean, azterketa gordetzen dizugu.' },
      gl: { title: 'A túa revisión visual segue pendente', body: 'Coidar a túa vista é rápido e sinxelo. Cando queiras, resérvámosche a revisión.' },
    },
    asesoria: {
      es: { title: 'No dejes pasar el vencimiento', body: 'Te escribimos hace unos días. Mejor revisar tu situación con tiempo — ¿lo vemos esta semana?' },
      eu: { title: 'Ez utzi epemuga pasatzen', body: 'Duela egun batzuk idatzi genizun. Hobe da zure egoera lasai berrikustea — aste honetan ikusten dugu?' },
      gl: { title: 'Non deixes pasar o vencemento', body: 'Escribímosche hai uns días. Mellor revisar a túa situación con tempo — vémolo esta semana?' },
    },
    hotel: {
      es: { title: 'Tu escapada te espera', body: 'La oferta para clientes habituales sigue en pie. Cuando te apetezca volver, aquí estamos.' },
      eu: { title: 'Zure ihesaldia zain duzu', body: 'Bezero ohientzako eskaintza zutik dago oraindik. Itzultzeko gogoa duzunean, hemen gaude.' },
      gl: { title: 'A túa escapada agárdate', body: 'A oferta para clientes habituais segue en pé. Cando che apeteza volver, aquí estamos.' },
    },
    academia: {
      es: { title: 'Aún quedan plazas', body: 'Las clases siguen abiertas para ti. Si quieres continuar tu formación, reservar es muy rápido.' },
      eu: { title: 'Plazak geratzen dira oraindik', body: 'Klaseak zabalik jarraitzen dute zuretzat. Zure prestakuntzarekin jarraitu nahi baduzu, hitzordua hartzea oso azkarra da.' },
      gl: { title: 'Aínda quedan prazas', body: 'As clases seguen abertas para ti. Se queres continuar a túa formación, reservar é moi rápido.' },
    },
    farmacia: {
      es: { title: 'Tu medicación te espera', body: 'Solo recordarte que puedes pasar a renovar o recoger tu pedido cuando te venga bien.' },
      eu: { title: 'Zure botikak zain dituzu', body: 'Gogorarazi nahi nizun berritzera edo eskaera jasotzera pasa zaitezkeela ondo datorkizunean.' },
      gl: { title: 'A túa medicación agárdate', body: 'Só lembrarte que podes pasar a renovar ou recoller o teu pedido cando che veña ben.' },
    },
    abogados: {
      es: { title: 'Tu asunto sigue ahí', body: 'Te escribimos hace unos días. Cuando quieras revisar tu situación, estamos a tu disposición.' },
      eu: { title: 'Zure gaia hor dago oraindik', body: 'Duela egun batzuk idatzi genizun. Zure egoera berrikusi nahi duzunean, zure esku gaude.' },
      gl: { title: 'O teu asunto segue aí', body: 'Escribímosche hai uns días. Cando queiras revisar a túa situación, estamos á túa disposición.' },
    },
    podologia: {
      es: { title: 'Tus pies siguen pendientes', body: 'Solo recordarte que tu revisión sigue disponible. Cuidarlos a tiempo evita molestias mayores.' },
      eu: { title: 'Zure oinak zain jarraitzen dute', body: 'Gogorarazi nahi nizun zure azterketa libre dagoela oraindik. Garaiz zaintzeak arazo handiagoak saihesten ditu.' },
      gl: { title: 'Os teus pés seguen pendentes', body: 'Só lembrarte que a túa revisión segue dispoñible. Coidalos a tempo evita molestias maiores.' },
    },
    spa: {
      es: { title: 'Tu momento de relax te espera', body: 'Sin prisa — cuando quieras desconectar, tu hueco está aquí. Reservar lleva un momento.' },
      eu: { title: 'Zure erlaxatzeko unea zain duzu', body: 'Presarik gabe — deskonektatu nahi duzunean, zure tartea hemen dago. Erreserbatzeak une bat besterik ez du.' },
      gl: { title: 'O teu momento de relax agárdate', body: 'Sen presa — cando queiras desconectar, o teu oco está aquí. Reservar leva un momento.' },
    },
    agencia_viajes: {
      es: { title: 'Tu próxima escapada te espera', body: 'Por si sigues con ganas de viajar — tenemos destinos nuevos. Cuéntanos y te lo preparamos.' },
      eu: { title: 'Zure hurrengo ihesaldia zain duzu', body: 'Bidaiatzeko gogoz jarraitzen baduzu — helmuga berriak ditugu. Esan iezaguzu eta prestatuko dizugu.' },
      gl: { title: 'A túa próxima escapada agárdate', body: 'Por se segues con ganas de viaxar — temos destinos novos. Cóntanos e prepararémoscho.' },
    },
    inmobiliaria: {
      es: { title: 'Han salido propiedades nuevas', body: 'Te escribimos hace unos días. Si tu búsqueda sigue activa, hay opciones que pueden interesarte.' },
      eu: { title: 'Jabetza berriak atera dira', body: 'Duela egun batzuk idatzi genizun. Zure bilaketak aktibo jarraitzen badu, interesa dakizukeen aukerak daude.' },
      gl: { title: 'Saíron propiedades novas', body: 'Escribímosche hai uns días. Se a túa busca segue activa, hai opcións que poden interesarte.' },
    },
    coaching: {
      es: { title: 'Tu objetivo sigue ahí', body: 'No pasa nada por parar un poco. Cuando quieras retomar tu progreso, aquí estoy.' },
      eu: { title: 'Zure helburua hor dago oraindik', body: 'Ez da ezer gertatzen apur bat gelditzeagatik. Zure aurrerapena berriz hartu nahi duzunean, hemen nago.' },
      gl: { title: 'O teu obxectivo segue aí', body: 'Non pasa nada por parar un pouco. Cando queiras retomar o teu progreso, aquí estou.' },
    },
    reformas: {
      es: { title: 'Tu presupuesto te espera', body: 'Te escribimos hace unos días. Si sigues con la idea, preparamos el presupuesto sin compromiso.' },
      eu: { title: 'Zure aurrekontua zain duzu', body: 'Duela egun batzuk idatzi genizun. Ideiarekin jarraitzen baduzu, aurrekontua prestatzen dugu konpromisorik gabe.' },
      gl: { title: 'O teu orzamento agárdate', body: 'Escribímosche hai uns días. Se segues coa idea, preparamos o orzamento sen compromiso.' },
    },
    guarderia_canina: {
      es: { title: 'Tu peludo tiene plaza', body: 'Solo recordarte que hay sitio cuando lo necesites. Reservar su estancia es muy rápido.' },
      eu: { title: 'Zure txakurrak plaza du', body: 'Gogorarazi nahi nizun lekua dagoela behar duzunean. Bere egonaldia erreserbatzea oso azkarra da.' },
      gl: { title: 'O teu peludo ten praza', body: 'Só lembrarte que hai sitio cando o precises. Reservar a súa estancia é moi rápido.' },
    },
    autoescuela: {
      es: { title: 'Tu carnet te espera', body: 'Solo recordarte que cada clase te acerca al aprobado. ¿Retomamos esta semana?' },
      eu: { title: 'Zure gidabaimena zain duzu', body: 'Gogorarazi nahi nizun klase bakoitzak gainditzera hurbiltzen zaituela. Aste honetan berriz hasten gara?' },
      gl: { title: 'O teu carné agárdate', body: 'Só lembrarte que cada clase te achega ao aprobado. Retomamos esta semana?' },
    },
    default: {
      es: { title: '¿Seguimos en contacto?', body: `Te escribimos hace unos días. Seguimos aquí cuando lo necesites — ${config?.name || 'estamos disponibles'} para ti.` },
      eu: { title: 'Oraindik hemen gaude', body: 'Duela egun batzuk idatzi genizun. Behar duzunean, hemen gaude.' },
      gl: { title: 'Seguimos en contacto?', body: `Escribímosche hai uns días. Seguimos aquí cando o precises — ${config?.name || 'estamos dispoñibles'} para ti.` },
    },
  };

  const fc = (FOLLOWUP_COPY[sector] || FOLLOWUP_COPY.default);
  const fl = fc[lang] || fc.es || FOLLOWUP_COPY.default.es;

  const greeting   = lang === 'eu' ? `Kaixo ${name}` : lang === 'gl' ? `Ola ${name}` : `Hola ${name}`;
  const ctaLabel   = lang === 'eu' ? 'Hitzordua hartu' : lang === 'gl' ? 'Reservar cita' : 'Reservar cita';
  const ctaWa      = lang === 'eu' ? 'WhatsApp bidez' : lang === 'gl' ? 'Por WhatsApp' : 'Por WhatsApp';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : lang === 'gl'
    ? 'Para non recibir máis recordatorios, responde a este correo.'
    : 'Para darte de baja de estos recordatorios, responde a este email.';

  const waText = encodeURIComponent(`Hola, soy ${rawName}. Me gustaría reservar una cita.`);
  const waLink = phone ? `https://wa.me/34${phone.replace(/\D/g,'')}?text=${waText}` : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f8;padding:32px 16px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <!-- HEADER — more personal, no logo -->
    <tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:22px 28px;border-bottom:2px solid ${sc.color};">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:16px;font-weight:800;color:#0f0f23;">${bizName} ${sc.emoji}</div>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- BODY -->
    <tr><td style="background:#ffffff;padding:24px 28px 20px;">
      <p style="font-size:19px;font-weight:800;color:#0f0f23;margin:0 0 8px;">${esc(fl.title)}</p>
      <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 24px;">
        ${greeting} 👋, ${esc(fl.body)}
      </p>

      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${sc.color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${ctaLabel}</a>
            </td></tr></table>
          </td>` : ''}
          ${waLink ? `<td>
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#25d366;">
              <a href="${waLink}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">💬 ${ctaWa}</a>
            </td></tr></table>
          </td>` : ''}
        </tr>
      </table>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:#f8f8fb;border-radius:0 0 16px 16px;padding:14px 28px;border-top:1px solid #e8e8f0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">${unsubLabel}</p>
      <p style="font-size:10px;color:#cbd5e1;margin:6px 0 0;">
        Gestionado por <a href="https://nodeflow.es" style="color:${sc.color};text-decoration:none;">NodeFlow IA</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${fl.title}`,
    ``,
    `${greeting}, ${fl.body}`,
    ``,
    phone ? `📞 ${ctaLabel}: ${phone}` : '',
    waLink ? `💬 ${ctaWa}: ${waLink}` : '',
    ``,
    unsubLabel,
  ].filter(l => l !== undefined && l !== null).join('\n');

  log.info(`Second-touch rebooking sent to ${client.email} (${sector}/${lang})`);
  return sendEmail({ to: client.email, subject: `${fl.title} — ${config?.name || ''}`, html, text });
}

module.exports = { sendRebookingEmail, sendRebookingFollowUp };
