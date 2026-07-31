#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   EL GALEGO: DECIR LO QUE ES, QUE SIGUE SIENDO BUENO
   ───────────────────────────────────────────────────────────────────────────
   Al quitar ElevenLabs se fue con ella `brais-gl`, la ÚNICA voz gallega del
   catálogo. Y el «servidor propio de síntesis para galego» que menciona la
   política de privacidad existe como hueco vacío en el código: el proveedor
   `local-gl` está registrado con el comentario «Will be updated when GL voices
   are cloned». No hay voces clonadas.

   QUÉ PASA HOY, MEDIDO CONTRA LA API DE CARTESIA:
     · El asistente ENTIENDE y RESPONDE en galego — el texto lo escribe el LLM
       en galego y está bien.
     · Ese texto lo lee una VOZ CASTELLANA. Comprobado sintetizando «Bo día,
       chamou a Hierros A Freixa»: 34.781 bytes de audio correcto.
     · Pero no es una voz gallega nativa, y no tiene acento gallego.

   O sea: lo que la web promete —«acento galego real», «entoación da nosa
   terra», «non é texto a voz robótica»— es exactamente lo contrario de lo que
   ocurre. Es el mismo caso que el euskera, con un agravante: aquí hay un
   CLIENTE REAL contratado en es+gl y una landing entera en galego.

   LO QUE SÍ SE PUEDE DECIR, y no es poco: atiende en galego, entiende a quien
   llama en galego y responde en galego. Para un negocio gallego eso ya es más
   de lo que hace su competencia. Lo que se retira es la promesa de la VOZ, no
   la del idioma.

   NO se toca la landing entera: `/galiza` sigue siendo una página en galego
   dirigida a negocios gallegos, porque el producto SÍ atiende en galego.

   Uso:  node scripts/galego-lo-que-es.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const dry = process.argv.includes('--dry');

const CAMBIOS = [
  // — Promesas de voz nativa / acento —
  ['La gente cuelga a los robots en 6 segundos. A NodeFlow no: voz natural, respuesta en menos de un segundo y galego nativo. Así se hace.',
   'La gente cuelga a los robots en 6 segundos. A NodeFlow no: voz natural y respuesta en menos de un segundo. Así se hace.'],
  ['Varias voces naturales en castellano (masculinas y femeninas, con estilos distintos), además de voces propias en galego.',
   'Varias voces naturales en castellano, masculinas y femeninas y con estilos distintos.'],
  ['¿El el galego son voces reales?',
   '¿Y en galego?'],
  ['Acento galego real',
   'Atende en galego'],
  ['Non é texto a voz robótica. É galego natural, con acento e entoación da nosa terra.',
   'Entende a quen chama en galego e respóndelle en galego. A voz é natural, aínda que non ten acento galego: iso preferimos dicilo antes que prometelo.'],
  ['🌊 Galego nativo', '🌊 Atende en galego'],
  ['Fala galego nativo', 'Atende en galego'],
  ['Atende todas as chamadas en galego nativo.', 'Atende todas as chamadas en galego.'],
  ['7 de cada 10 galegos comunícanse en galego. Os teus clientes merecen ser atendidos no seu idioma — non nun castelán robótico nin nun inglés de película.',
   'Moitos dos teus clientes prefiren falar en galego. Merecen que alguén os entenda e lles conteste no seu idioma, tamén ás dez da noite.'],

  // — La política de privacidad prometía infraestructura que no sirve nada —
  ['tenemos un servidor propio de síntesis de voz para galego, pensado para que esos datos se procesen localmente.',
   'tenemos preparada la infraestructura para alojar voces propias, aunque hoy la síntesis la hacen proveedores externos.'],
  ['Además, algunas piezas ni siquiera salen de casa: las voces en galego se generan en infraestructura propia, en local, sin proveedor externo.',
   'Cuando alojemos voces propias, esa parte dejará de salir de nuestra infraestructura; hoy todavía no es el caso.'],
  ['La primera, que suenan a galego de verdad, no a castellano con acento raro.',
   'La primera, que la conversación entera ocurra en galego y no a medias.'],

  // — Y la promesa de la portada del blog —
  ['Cuando suena el teléfono de tu negocio y estás ocupado, NodeFlow responde al momento con una voz natural, en castellano o galego.',
   'Cuando suena el teléfono de tu negocio y estás ocupado, NodeFlow responde al momento con una voz natural, y atiende en castellano o en galego.'],

  ['En un mundo donde la personalización es la clave del éxito, disponer de una asistente IA que hable gallego nativo no es solo un lujo, sino una necesidad para los negocios gallegos.',
   'Para un negocio gallego, que quien llama pueda explicarse en galego y le contesten en galego no es un lujo: es lo que espera cualquiera que llame a un sitio de su tierra.'],

  // LA ÚLTIMA A PROPÓSITO: 'galego nativo' es subcadena de casi todas las de
  // arriba. Puesta antes, se las comía y esas reglas dejaban de encajar — el
  // texto acababa bien igualmente, pero el informe decía «no encajó» y eso
  // hace dudar de si el cambio se aplicó. Un script que se contradice a sí
  // mismo en el informe no sirve para decidir nada.
  ['galego nativo', 'galego'],
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

let cambiadas = 0, tocadas = 0;
const usados = new Set();
for (const f of paginas()) {
  const antes = fs.readFileSync(f, 'utf8');
  let s = antes;
  // Orden IMPORTANTE: las cadenas largas primero, porque 'galego nativo' es
  // subcadena de varias de ellas y aplicarla antes las dejaría sin encajar.
  for (const [de, a] of CAMBIOS) {
    if (!s.includes(de)) continue;
    s = s.split(de).join(a); cambiadas++; usados.add(de);
  }
  if (s === antes) continue;
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
}

// Comprobación: no puede quedar ninguna promesa de voz o acento gallego.
// El detector NO puede cazar la negación: «non ten acento galego» es
// justamente la frase honesta que se ha puesto en su lugar. Un chivato que
// denuncia el arreglo se acaba ignorando, y entonces deja de avisar de nada.
const PROHIBIDO = /galego nativo|gallego nativo|(?<!non ten )(?<!sin )acento galego|acento gallego|voces propias en galego|entoación da nosa terra|suenan a galego de verdad|servidor propio de síntesis de voz para galego/i;
const quedan = [];
for (const f of paginas()) {
  const h = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const t = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const m of t.matchAll(new RegExp(PROHIBIDO.source, 'gi'))) {
    quedan.push(`${rel(f)}: «${t.slice(Math.max(0, m.index - 30), m.index + 60).trim()}»`);
  }
}

const sinUsar = CAMBIOS.filter(([de]) => !usados.has(de)).map(([de]) => de.slice(0, 55));
console.log(`${dry ? 'ENSAYO — no se ha escrito nada.\n' : ''}Páginas tocadas: ${tocadas} · frases reescritas: ${cambiadas}`);
if (sinUsar.length) {
  console.log(`\n${sinUsar.length} reglas que no encajaron:`);
  sinUsar.forEach(x => console.log('   · ' + x + '…'));
}
if (!dry && quedan.length) {
  console.log(`\n⚠ SIGUEN prometiendo voz o acento gallego (${quedan.length}):`);
  [...new Set(quedan)].slice(0, 10).forEach(x => console.log('   · ' + x));
  process.exitCode = 1;
}
