#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   OPCIÓN C: FUENTE REAL PARA LO QUE SOSTIENE UN ARTÍCULO, FUERA EL RESTO
   ───────────────────────────────────────────────────────────────────────────
   Quedaban ~180 cifras sueltas. No mentían sobre nosotros ni citaban un
   estudio falso, pero tampoco se sostenían: el mismo 60-70% reciclado con
   distinto sujeto, y con precisión local inventada —«el 45% de las clínicas de
   fisioterapia EN VITORIA-GASTEIZ»—. Nadie ha encuestado a los fisios de
   Vitoria.

   Se buscó fuente de verdad. Esto es lo que hay y lo que no:

   ✅ SIRVEN, y son mejores que lo que había:
      · INVOCA (2024): el 27% de las llamadas entrantes a negocios de servicios
        se quedan sin contestar. Análisis de más de 60 millones de llamadas.
        Muestra enorme, método declarado, año reciente.
      · META-ANÁLISIS CLÍNICOS sobre recordatorios: los SMS reducen las
        ausencias (RR 0,77; IC95% 0,71-0,84) y quien recibe aviso acude un 23%
        más y falta un 25% menos. Revisión sistemática, revisado por pares.
        Varios avisos funcionan mejor que uno solo.
      · INE, encuesta TIC y comercio electrónico (2024 / T1 2025): el 21,1% de
        las empresas españolas ya usa IA, 8,8 puntos más que el año anterior.
        Estadística oficial.

   ❌ NO SIRVE, y es justo el origen del número que el blog reciclaba:
      El famoso «62% de las llamadas a pequeños negocios no se contestan» sale
      de un estudio de 411 Locals de 2016 SIN METODOLOGÍA PUBLICADA. No es
      inventado, pero no pasa el mismo listón con el que acabo de barrer 76
      afirmaciones. Se cae. Citarlo sería aplicarme una vara distinta a la que
      le aplico a todo lo demás.

   REGLA DE ESCRITURA. Cuando se cita, se cita CON SUS LÍMITES: quién lo midió,
   sobre qué y dónde. «Invoca analizó más de 60 millones de llamadas a negocios
   de servicios en EE.UU.» vale; «los estudios dicen» no vale. Y donde no hay
   dato, se dice que no lo hay y se manda a medir el teléfono propio — que es
   lo único que de verdad le importa a quien está leyendo.

   Uso:  node scripts/datos-con-fuente.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const dry = process.argv.includes('--dry');

// Las tres anclas, escritas una vez y reutilizadas.
const F = {
  invoca: 'Invoca analizó más de 60 millones de llamadas a negocios de servicios en 2024: el 27% se quedó sin contestar',
  recordatorios: 'Las revisiones sistemáticas de recordatorios de cita en sanidad son claras: quien recibe un aviso acude un 23% más y falta un 25% menos, y varios avisos funcionan mejor que uno solo',
  ine: 'Según la encuesta de TIC del INE, el 21,1% de las empresas españolas ya usa inteligencia artificial, 8,8 puntos más que el año anterior',
};

// ── Los 39 ganchos «¿Sabías que…?» ────────────────────────────────────────
// Cada uno abría un artículo con una cifra que nadie había medido. Los que
// tratan de algo con fuente real la llevan; el resto pasan a una pregunta
// concreta y verdadera, que además es más específica que el porcentaje que
// sustituyen.
const GANCHOS = [
  // — Llamadas sin contestar: aquí SÍ hay dato, y es mejor que el inventado —
  ['¿Sabías que el 30% de las llamadas a clínicas dentales nunca son contestadas?',
   `¿Sabías que ${F.invoca}?`],
  ['¿Sabías que el 30% de las llamadas a clínicas dentales se pierden?',
   `¿Sabías que ${F.invoca}?`],
  ['¿Sabías que hasta un 30% de las llamadas a clínicas dentales quedan sin respuesta?',
   `¿Sabías que ${F.invoca}?`],
  ['¿Sabías que el 62% de las llamadas a pequeñas empresas quedan sin respuesta?',
   `¿Sabías que ${F.invoca}?`],
  ['¿Sabías que el 62% de las llamadas a pequeñas y medianas empresas en España no se contestan?',
   '¿Cuántas llamadas se te escapan al mes? En España nadie lo ha medido con rigor — pero tu centralita sí lo sabe.'],
  ['¿Sabías que el 60% de las llamadas perdidas nunca se devuelven?',
   '¿Cuántos de los que te llaman y no consiguen respuesta vuelven a intentarlo?'],
  ['¿Sabías que el 60% de las llamadas perdidas nunca vuelven a llamar?',
   '¿Cuántos de los que te llaman y no consiguen respuesta vuelven a intentarlo?'],
  ['¿Sabías que el 60% de las llamadas a peluquerías en España se pierden por no ser atendidas a tiempo?',
   '¿Sabes cuántas llamadas entran en tu peluquería mientras estás con un cliente en el lavacabezas?'],
  ['¿Sabías que el 40% de las citas en peluquerías se pierden por falta de respuesta inmediata?',
   '¿Sabes cuántas citas se pierden entre el momento en que suena el teléfono y el momento en que puedes cogerlo?'],
  ['¿Sabías que las peluquerías en España pierden hasta un 15% de los ingresos potenciales por citas no gestionadas adecuadamente?',
   '¿Sabes cuánto vale una silla vacía un sábado por la mañana?'],
  ['¿Sabías que el 60% de los talleres mecánicos en España pierden clientes por una mala gestión de citas?',
   '¿Sabes cuántas llamadas entran en tu taller mientras estás debajo de un coche?'],
  ['¿Sabías que el 60% de las llamadas a talleres mecánicos no son atendidas debido a la falta de personal?',
   '¿Quién coge el teléfono de tu taller cuando los dos mecánicos están ocupados?'],
  ['¿Sabías que un 70% de las llamadas a clínicas veterinarias no son atendidas en horas punta?',
   '¿Quién atiende una urgencia veterinaria que entra por teléfono a las nueve de la noche?'],
  ['¿Sabías que más del 60% de las llamadas a inmobiliarias no se contestan fuera del horario laboral?',
   '¿Quién contesta cuando alguien llama interesado por un piso un domingo por la tarde?'],

  // — Consultas repetitivas —
  ['¿Sabías que el 70% de las consultas en academias son repetitivas y pueden ser automatizadas?',
   '¿Cuántas veces al día explica tu academia el mismo horario y el mismo precio?'],
  ['¿Sabías que el 65% de las consultas en academias son repetitivas?',
   '¿Cuántas veces al día explica tu academia el mismo horario y el mismo precio?'],
  ['¿Sabías que el 70% de las consultas en gimnasios se repiten?',
   '¿Cuántas veces al día explica tu gimnasio los mismos horarios y las mismas tarifas?'],
  ['¿Sabías que más del 60% de las llamadas a asesorías en España son consultas repetitivas?',
   '¿Cuántas de las llamadas a tu asesoría son la misma pregunta de siempre sobre plazos y documentación?'],
  ['¿Sabías que el 70% de las llamadas a farmacias son para preguntar por turnos y disponibilidad de medicamentos?',
   '¿Cuántas veces al día contesta tu farmacia a «¿estáis de guardia?» y «¿hasta qué hora abrís?»?'],

  // — Fuera de horario —
  ['¿Sabías que un 75% de los clientes prefieren contactar con negocios fuera del horario laboral?',
   '¿Qué pasa con quien te llama al salir de trabajar, cuando tú ya has cerrado?'],
  ['¿Sabías que el 60% de las reservas se realizan fuera del horario comercial?',
   '¿Qué pasa con la reserva que entra cuando el restaurante ya ha cerrado la cocina?'],
  ['¿Sabías que el 60% de las llamadas a negocios en España ocurren fuera del horario comercial?',
   '¿Qué pasa con las llamadas que entran cuando ya no hay nadie para cogerlas?'],

  // — Gestión manual / adopción: aquí el dato del INE es oficial —
  ['¿Sabías que el 75% de las pymes en España todavía gestionan sus llamadas telefónicas de manera manual?',
   `¿Sabías que ${F.ine}?`],
  ['¿Sabías que el 75% de las pymes españolas ya están integrando asistentes de voz IA en sus operaciones diarias?',
   `¿Sabías que ${F.ine}?`],
  ['¿Sabías que más del 70% de los centros de estética en Vitoria-Gasteiz todavía gestionan sus citas de forma manual?',
   '¿Sigues apuntando las citas de tu centro en una agenda de papel y devolviendo llamadas entre cliente y cliente?'],
  ['¿Sabías que más del 70% de las clínicas de fisioterapia en España aún gestionan sus citas manualmente?',
   '¿Sigue tu clínica devolviendo llamadas entre paciente y paciente?'],
  ['¿Sabías que más del 70% de los fisioterapeutas en Bilbao buscan formas de optimizar su gestión diaria?',
   '¿Cuánto de tu día se va en el teléfono en vez de en la camilla?'],

  // — Ausencias y plantones: el meta-análisis es lo más sólido que hay —
  ['¿Sabías que los no-shows pueden costar a un negocio hasta un 20% de sus ingresos anuales?',
   `¿Sabías que ${F.recordatorios}?`],
  ['¿Sabías que el 45% de las clínicas de fisioterapia en Vitoria-Gasteiz reportan problemas con las ausencias de pacientes?',
   `¿Sabías que ${F.recordatorios}?`],
  ['¿Sabías que el 70% de las clínicas de fisioterapia en España pierden citas por falta de seguimiento?',
   `¿Sabías que ${F.recordatorios}?`],
  ['¿Sabías que el 30% de las llamadas a clínicas dentales son para gestionar citas?',
   `¿Sabías que ${F.recordatorios}?`],

  // — El resto: pregunta concreta, sin cifra —
  ['¿Sabías que el 70% de los gimnasios en Bilbao pierden potenciales clientes por no responder a tiempo las consultas?',
   '¿Cuántos posibles socios llaman a tu gimnasio y cuelgan sin que nadie lo sepa?'],
  ['¿Sabías que el 70% de los gimnasios en España pierden clientes por una mala gestión de inscripciones y consultas?',
   '¿Cuántos posibles socios se quedan sin darse de alta porque nadie les cogió el teléfono?'],
  ['¿Sabías que el 70% de los viajeros prefieren alojamientos que ofrezcan procesos de check-in automatizados?',
   '¿Quién responde a la consulta de una reserva cuando la recepción está atendiendo a un huésped?'],
  ['¿Sabías que aproximadamente el 70% de los pacientes de fisioterapia en España utilizan un seguro privado?',
   '¿Cuántas de las llamadas a tu clínica son para preguntar si trabajáis con su seguro?'],
  ['¿Sabías que el 70% de las empresas en España no cumplen completamente con la RGPD?',
   '¿Sabes dónde se guardan las grabaciones de las llamadas de tu negocio y cuánto tiempo?'],
  ['¿Sabías que el 60% de los clientes de restaurantes prefieren hacer reservas en línea o por teléfono en lugar de ir en persona?',
   '¿Quién coge el teléfono de tu restaurante en pleno servicio de comidas?'],
  ['¿Sabías que el 70% de los dueños de mascotas en Bilbao prefieren gestionar sus citas veterinarias online?',
   '¿Quién atiende el teléfono de tu clínica mientras estás en mitad de una consulta?'],
  ['¿Sabías que el 65% de los gallegos prefieren comunicarse en su lengua materna cuando interactúan con empresas?',
   '¿Y si quien llama a tu negocio prefiere que le atiendan en galego?'],
];

function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'hementxe') paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');

let cambiados = 0, tocadas = 0;
const usados = new Set();
// Resultado en memoria: las comprobaciones del final se hacen SOBRE ESTO. Es la
// tercera vez esta noche que un informe en ensayo mide el disco —que en ensayo
// no ha cambiado— y dice que no se ha arreglado nada. Un ensayo que miente
// sobre su propio resultado no sirve para decidir si aplicar.
const resultado = new Map();
for (const f of paginas()) {
  const antes = fs.readFileSync(f, 'utf8');
  let s = antes;
  for (const [de, a] of GANCHOS) {
    if (!s.includes(de)) continue;
    s = s.split(de).join(a);
    cambiados++; usados.add(de);
  }
  if (s === antes) continue;
  resultado.set(rel(f), s);
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
}

const sinUsar = GANCHOS.filter(([de]) => !usados.has(de)).map(([de]) => de);

// ¿Queda algún «¿Sabías que…?» con una cifra sin fuente?
const quedan = [];
for (const f of paginas()) {
  const h = (resultado.get(rel(f)) ?? fs.readFileSync(f, 'utf8')).replace(/<[^>]+>/g, ' ');
  for (const m of h.matchAll(/¿Sabías que[^?]{0,190}\?/g)) {
    if (/\d{1,3}\s?%/.test(m[0]) && !/Invoca|INE|revisiones sistemáticas/.test(m[0]))
      quedan.push(`${rel(f)}: ${m[0].replace(/\s+/g, ' ').trim().slice(0, 110)}`);
  }
}

console.log(`${dry ? 'ENSAYO — no se ha escrito nada.\n' : ''}Páginas tocadas: ${tocadas} · ganchos reescritos: ${cambiados}`);
if (sinUsar.length) {
  console.log(`\n${sinUsar.length} reglas declaradas que no encajaron con nada:`);
  sinUsar.slice(0, 8).forEach(x => console.log('   · ' + x.slice(0, 100)));
}
if (quedan.length) {
  console.log(`\n⚠ Siguen abriendo con una cifra sin fuente (${quedan.length}):`);
  [...new Set(quedan)].slice(0, 15).forEach(x => console.log('   · ' + x));
  process.exitCode = 1;
} else {
  console.log('\nNingún artículo abre ya con una cifra sin fuente.');
}
