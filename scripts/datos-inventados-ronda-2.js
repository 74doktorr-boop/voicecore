#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   LOS QUE SE ESCAPARON EN LA PRIMERA RONDA
   ───────────────────────────────────────────────────────────────────────────
   Anoche dije que quedaban CERO afirmaciones de resultados de clientes. Era
   falso, y por dos motivos que conviene no repetir:

   1. El recuento que usé para decirlo llevaba `return` donde iba `continue` al
      recorrer directorios: abandonaba la carpeta al primer fichero que no
      fuera HTML. Contaba una fracción del sitio y daba cero con aplomo.

   2. Y aunque el recorrido hubiera estado bien, mi expresión de búsqueda sólo
      cazaba «han visto», «reportó», «tras implementar». No cazaba «los
      negocios de Andoain QUE LO USAN», ni «las clínicas QUE USAN recordatorios
      automáticos», que dicen exactamente lo mismo con otras palabras.

   La lección es la de siempre en este repo, otra vez: **un recuento no
   demuestra ausencia; demuestra que tu patrón no encontró nada**. Los tests,
   que recorren bien, son los que valen — y por eso el patrón de este fichero
   se añade también al test.

   Siguen siendo lo de siempre: en producción hay cuatro organizaciones, las
   cuatro propias, con cuatro llamadas reales en treinta días. Ninguna clínica
   nos ha reportado nada porque no hay clínicas.

   NO se toca la comisión del 15-18% de las OTAs: ese es un dato externo del
   sector hotelero, no un resultado nuestro.

   Uso:  node scripts/datos-inventados-ronda-2.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const dry = process.argv.includes('--dry');

// Se sustituyen por lo que SÍ se puede sostener: lo que hace el producto, o
// que el número se lo saque cada uno de su propio panel.
const CAMBIOS = [
  ['Los negocios de Andoain que lo usan captan el 23% de sus reservas fuera de horario.',
   'Las llamadas que entran con el negocio cerrado hoy se pierden. El asistente las coge y deja la cita puesta.'],
  ['La tasa de renovación de clientes en ópticas que usan recordatorios automáticos es entre un 25 y un 40% superior a las que no lo hacen.',
   'El recordatorio de renovación sale a los 18-24 meses, que es cuando toca revisar la graduación y cuando el cliente ya no se acuerda.'],
  ['En Donostia, el 70% de los restaurantes reportan pérdidas de hasta un 20% en ingresos debido a una gestión ineficiente de las reservas.',
   'En Donostia, el teléfono de un restaurante suena justo en pleno servicio, que es cuando nadie puede cogerlo.'],
  ['los negocios que han adoptado esta tecnología reportan un aumento del 20% en la satisfacción del cliente y una reducción del 15% en los costes operativos relacionados con la gestión de citas.',
   'la cita queda escrita en la agenda que ya usabas, sin copiarla a mano y sin que nadie tenga que acordarse de pasarla.'],
  ['ha registrado un crecimiento del 180% en el número de pymes que utilizan algún tipo de asistente IA para la atención telefónica.',
   'ha visto crecer con fuerza el número de pymes que usan asistentes de voz, aunque nadie ha publicado todavía una cifra que se pueda citar.'],
  ['Las farmacias que han implementado este sistema reportan una reducción del 50% en el tiempo dedicado a estas consultas.',
   'El asistente responde a los turnos de guardia y los horarios sin que el farmacéutico tenga que dejar el mostrador.'],
  ['las clínicas de fisioterapia reportan una tasa de no-show del 15%.',
   'las sesiones perdidas por olvido son el agujero silencioso de una clínica de fisioterapia.'],
  ['Las clínicas dentales que usan recordatorios automáticos reducen los no-shows hasta un 40%, lo que equivale a varios miles de euros de ingresos recuperados al mes.',
   'El recordatorio sale 24 horas antes, que es cuando el hueco todavía se puede volver a llenar. Lo que eso vale al mes lo dice tu propia agenda.'],
  ['Las clínicas que usan recordatorios automáticos reducen los no-shows hasta un 40%.',
   'El recordatorio sale 24 horas antes, que es cuando el hueco todavía se puede volver a llenar.'],
  // — Los tres que se escaparon incluso a la segunda pasada. El primero es la
  //   MISMA frase de /clinicas con una coletilla distinta al final: por eso la
  //   sustitución literal no encajó. El segundo inventa «un análisis» que no
  //   existe. Y el tercero es un EPÍGRAFE que promete casos de éxito, con su
  //   entrada en el índice de contenidos — no hay ninguno que enseñar.
  ['Las clínicas dentales que usan recordatorios automáticos reducen los no-shows hasta un 40%, lo que equivale a varios miles de euros de ingresos recuperados al mes en una clínica mediana.',
   'El recordatorio sale 24 horas antes, que es cuando el hueco todavía se puede volver a llenar. Lo que eso vale al mes lo dice tu propia agenda.'],
  ['Un análisis de centros que han implementado IA muestra un aumento del 30% en la satisfacción del estudiante, gracias a la rapidez y precisión en las respuestas.',
   'Responder al instante a lo que se pregunta cien veces —horarios, precios, plazas— evita que el interesado se canse y llame a la academia de al lado.'],
  ['En Bilbao, el 70% de las peluquerías reportan un aumento de llamadas perdidas en horas pico.',
   'En Bilbao, el teléfono de una peluquería suena justo cuando tienes las manos en un tinte.'],
  ['Casos de Éxito: Peluquerías que ya Usan IA en Bilbao',
   'Qué cambia en el día a día de una peluquería'],
];

function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // `continue`, NO `return`: con return se abandona la carpeta entera al
    // primer fichero que no sea HTML. Ese fue el bug que hizo que anoche
    // diera «cero» sin haber mirado el sitio completo.
    if (e.isDirectory()) { if (e.name !== 'hementxe') paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

let cambiadas = 0, tocadas = 0;
const usados = new Set();
for (const f of paginas()) {
  const antes = fs.readFileSync(f, 'utf8');
  let s = antes;
  for (const [de, a] of CAMBIOS) {
    if (!s.includes(de)) continue;
    s = s.split(de).join(a); cambiadas++; usados.add(de);
  }
  if (s === antes) continue;
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
}

const sinUsar = CAMBIOS.filter(([de]) => !usados.has(de)).map(([de]) => de.slice(0, 60));
console.log(`${dry ? 'ENSAYO — no se ha escrito nada.\n' : ''}Páginas tocadas: ${tocadas} · frases sustituidas: ${cambiadas}`);
if (sinUsar.length) {
  console.log(`\n${sinUsar.length} reglas que no encajaron con nada:`);
  sinUsar.forEach(x => console.log('   · ' + x + '…'));
}
