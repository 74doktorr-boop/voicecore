#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   FUERA LOS DATOS QUE NO SE SOSTIENEN
   ───────────────────────────────────────────────────────────────────────────
   Apareció limpiando otra cosa: «la Clínica VetBilbao implementó NodeFlow y
   vio un aumento del 15% en nuevos clientes». Ese cliente no existe. Tirando
   del hilo salieron 54 afirmaciones más del mismo tipo repartidas por el blog
   y las páginas de sector: clínicas que «reportaron» un 40% menos de
   ausencias, gimnasios con «ROI del 150% en el primer año», «según datos
   internos de academias que utilizan NodeFlow»…

   EL DATO QUE LAS DESMONTA TODAS: en producción hay CUATRO organizaciones, las
   cuatro son de Unai, y suman cuatro llamadas reales en treinta días. No hay
   ningún cliente que haya reportado nada. Ni uno.

   Por qué importa más que la promesa del euskera: la empresa se vende diciendo
   que no se inventa nada —que cada decisión de la IA queda registrada y se
   puede repasar— y al mismo tiempo la web enseñaba resultados de clientes que
   no existen. Un comprador que pida ver uno de esos casos se encuentra con que
   no hay nada detrás, y ahí no se pierde una venta: se pierde la credibilidad
   de todo lo demás, incluido lo que sí es verdad.

   QUÉ SE TOCA Y QUÉ NO. Sólo las afirmaciones de RESULTADO OBSERVADO en
   clientes. NO se tocan:
     · las capacidades del producto («atiende el 100% de las llamadas»), que
       son comprobables poniéndolo a funcionar;
     · la aritmética de coste frente a una persona, que es una división;
     · los datos externos del sector (la comisión del 15-18% de las OTAs).

   CÓMO. Por defecto se ELIMINA la frase entera. Son frases aditivas —«Por
   ejemplo, una clínica reportó…»— y el párrafo se sostiene sin ellas. Donde la
   frase ES el contenido de una tarjeta, borrarla dejaría un hueco: ahí va una
   sustitución escrita a mano, declarada abajo.

   Uso:  node scripts/quitar-datos-inventados.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const dry = process.argv.includes('--dry');

// Frases que NO se borran: se sustituyen, porque son el contenido visible de
// una tarjeta o de un dato destacado y dejarlas vacías se vería.
const SUSTITUCIONES = [
  ['Las peluquerías que usan NodeFlow reciben el 23% de sus reservas fuera de horario laboral.',
   'Las llamadas que entran con el salón cerrado hoy se pierden. El asistente las coge y deja la cita puesta.'],
  ['Los centros de estética con NodeFlow reciben el 25% de sus reservas fuera de horario laboral.',
   'Las llamadas que entran con el centro cerrado hoy se pierden. El asistente las coge y deja la cita puesta.'],
  ['Las cancelaciones de última hora caen un 40% de media en las peluquerías que usan NodeFlow.',
   'El recordatorio sale 24 horas antes, que es cuando el hueco todavía se puede volver a llenar.'],
  ['Los restaurantes que usan NodeFlow reducen los no-shows un 40% de media.',
   'El recordatorio sale la víspera, que es cuando una mesa cancelada todavía se puede volver a dar.'],
  ['Los psicólogos de Bilbao que usan NodeFlow recuperan de media 45 minutos al día que antes dedicaban a gestión telefónica.',
   'El teléfono deja de sonar en mitad de la sesión: el asistente lo coge, recoge el motivo y propone hora.'],
  ['Con una media de 25-40 llamadas diarias en una óptica mediana, NodeFlow captura el 100% del tráfico telefónico.',
   'En una óptica con 25-40 llamadas al día, ninguna se queda sin coger: las que entran a la vez o fuera de horario también.'],
  // Bloque de comparativa con cifras que nadie ha medido en ninguna óptica.
  ['Estimaciones basadas en ópticas con 25-40 llamadas/día en Bizkaia y Gipuzkoa.',
   'Sin datos de clientes todavía: cada óptica lo mide en su propio panel desde la primera semana.'],

  // — Cinco citas a estudios que se me escaparon en el primer barrido porque no
  //   llevaban un porcentaje en la misma oración. Aquí NO vale tratarlas igual:
  //   una de ellas es un hallazgo real y muy citado, sólo que sin atribuir. Ese
  //   se ARREGLA dando la fuente de verdad, no se borra: es de las cosas más
  //   útiles que dice el artículo. —
  ['Según estudios de productividad, recuperar el nivel de concentración tras una interrupción tarda entre 3 y 23 minutos.',
   'El trabajo de Gloria Mark en la Universidad de California en Irvine midió cuánto cuesta volver a lo que estabas haciendo tras una interrupción: una media de unos 23 minutos.'],
  // Ésta es cierta y conocida en el sector óptico; sobra la cita inventada.
  ['Los estudios del sector indican que el ciclo natural de renovación de gafas es de 18 a 24 meses, pero sin un recordatorio activo, muchos clientes esperan 3 o 4 años.',
   'El ciclo natural de renovación de unas gafas ronda los 18-24 meses, pero sin un recordatorio activo muchos clientes esperan 3 o 4 años.'],
  // Vacía: quitar la cita no le resta nada porque no decía nada.
  ['Estudios muestran que los clientes valoran un tiempo de respuesta rápido, y con la IA, puedes reducir el tiempo de espera a prácticamente cero.',
   'Nadie que llama quiere esperar, y el asistente descuelga al segundo tono aunque entren tres llamadas a la vez.'],
  // Cifra inventada con fuente inventada.
  ['Según estudios, una llamada perdida puede costarle a una pyme española entre 100 y 500 euros en oportunidades de negocio.',
   'Lo que cuesta una llamada perdida depende del negocio, y por eso no damos una cifra: en el panel se ve el valor de las citas que entraron por teléfono, y de ahí sale la tuya.'],
  ['Según un informe de 2025, el 70% de las consultas de clientes pueden ser resueltas eficazmente por una IA bien entrenada, liberando así al personal humano para concentrarse en problemas más críticos.',
   'Buena parte de lo que se pregunta por teléfono es siempre lo mismo —horarios, precios, si hay hueco— y eso lo resuelve el asistente sin que nadie tenga que soltar lo que está haciendo.'],
];

// Las 54 afirmaciones de resultado observado. Se eliminan enteras.
// Se cargan del fichero que las extrajo para que las cadenas sean EXACTAS: una
// coma distinta al copiarlas a mano y el reemplazo no encaja, y el script diría
// que ha limpiado algo que sigue ahí.
const resultados = require('./datos-inventados.json');

// Y 22 frases que CITAN UN ESTUDIO QUE NO EXISTE: «un estudio reciente muestra
// que…», «según estudios…», «un estudio de 2024 sobre pymes españolas…».
//
// Es exactamente la misma mentira que el cliente inventado, sólo que con menos
// cara: no se atribuye el dato a un cliente, se atribuye a una investigación
// que nadie ha hecho ni puede enseñar. Un porcentaje suelto es flojo; inventarse
// la fuente es otra cosa. Se van con las demás.
//
// Lo que NO se toca aquí, y es una decisión consciente: las ~180 cifras sueltas
// del tipo «el 30% de las llamadas a clínicas no se contestan». No son
// afirmaciones sobre NOSOTROS ni citan una fuente falsa, y quitarlas todas
// cambia la estrategia de contenidos del blog entero. Eso es decisión de Unai,
// no de un script escrito a las tantas.
const estudios = require('./estudios-inventados.json');
const claims = [...resultados, ...estudios];

function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'hementxe') paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');

let borradas = 0, sustituidas = 0, tocadas = 0, sinEncontrar = [];
const resultado = new Map();

/**
 * El JSON-LD se PARSEA. Nunca cirugía de texto.
 *
 * La primera versión de este script borraba las frases de todo el HTML por
 * igual, y tres de ellas vivían DENTRO de una cadena del schema. El corte se
 * llevó el `acceptedAnswer` y dejó la pregunta coja: JSON inválido en tres
 * páginas, o sea Google descartando el schema entero de esas tres. Lo cazó el
 * test de JSON-LD que había escrito unas horas antes por este mismo motivo, lo
 * cual dice bastante de por qué merece la pena escribirlos.
 *
 * Aquí se quita la pregunta ENTERA cuando su respuesta contiene una afirmación
 * inventada: una pregunta sin respuesta no es un arreglo, es otro destrozo.
 */
function limpiarSchema(html, frases) {
  return html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (todo, cuerpo) => {
    if (!frases.some(t => cuerpo.includes(t))) return todo;
    let datos;
    try { datos = JSON.parse(cuerpo); } catch { return todo; } // ya venía roto: no empeorarlo
    let tocado = false;
    const podar = (n) => {
      if (Array.isArray(n)) { n.forEach(podar); return; }
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.mainEntity)) {
        const antes = n.mainEntity.length;
        n.mainEntity = n.mainEntity.filter(q => !frases.some(t => JSON.stringify(q).includes(t.replace(/"/g, '\\"'))));
        if (n.mainEntity.length !== antes) tocado = true;
      }
      for (const k of ['description', 'text', 'headline']) {
        if (typeof n[k] === 'string') {
          for (const t of frases) {
            if (n[k].includes(t)) { n[k] = n[k].split(t).join('').replace(/\s{2,}/g, ' ').trim(); tocado = true; }
          }
        }
      }
      Object.values(n).forEach(podar);
    };
    podar(datos);
    if (!tocado) return todo;
    return `<script type="application/ld+json">\n${JSON.stringify(datos, null, 2)}\n  </script>`;
  });
}

for (const f of paginas()) {
  const antes = fs.readFileSync(f, 'utf8');
  let s = antes;

  // 1º el schema, parseando. 2º el resto del HTML, y ya SIN los bloques de
  // schema por medio: se apartan, se limpia el resto, y se devuelven intactos.
  s = limpiarSchema(s, claims.map(c => c.s).concat(SUSTITUCIONES.map(x => x[0])));
  const apartados = [];
  s = s.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, (m) => {
    apartados.push(m); return ` LD${apartados.length - 1} `;
  });

  for (const [de, a] of SUSTITUCIONES) {
    if (s.includes(de)) { s = s.split(de).join(a); sustituidas++; }
  }
  for (const c of claims) {
    if (!s.includes(c.s)) continue;
    s = s.split(c.s).join('');
    borradas++;
  }
  s = s.replace(/ LD(\d+) /g, (_, i) => apartados[+i]);
  if (s === antes) continue;

  // Limpieza de lo que deja una frase al irse: párrafos vacíos, espacios
  // dobles antes de un cierre, y el hueco entre dos frases.
  s = s.replace(/<p>\s*<\/p>/g, '')
       .replace(/<p([^>]*)>\s*<\/p>/g, '')
       .replace(/ {2,}(?=[<A-ZÁÉÍÓÚÑa-z])/g, ' ')
       .replace(/\s+<\/p>/g, '</p>');

  resultado.set(rel(f), s);
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
}

for (const c of claims) {
  const enAlguna = paginas().some(f => (resultado.get(rel(f)) ?? fs.readFileSync(f, 'utf8')).includes(c.s));
  if (enAlguna) sinEncontrar.push(`${c.f}: ${c.s.slice(0, 70)}…`);
}

// ── Control de destrozos, sobre el RESULTADO ──────────────────────────────
// Reglas de PROSA: sólo sobre el texto visible. Aplicarlas al HTML crudo hacía
// saltar «, .» en las 182 páginas, porque eso aparece en cualquier selector CSS
// («h1, .titulo»). Un chivato que señala todo no señala nada.
const SOSPECHAS_TEXTO = [
  [/\s+en\s*\.(?!\.)/, '«… en .» — preposición huérfana'],
  [/\s+y\s*\.(?!\.)/, '«… y .» — conjunción huérfana'],
  [/,\s*\.(?!\.)/, '«, .» — coma pegada a un punto'],
  [/\s+—\s*\.(?!\.)/, '«— .» — inciso vacío'],
];
// Ésta sí es de marcado y va sobre el HTML.
const SOSPECHAS_HTML = [[/<p[^>]*>\s*<\/p>/, 'párrafo vacío']];
const rotos = [];
for (const f of paginas()) {
  const h = resultado.get(rel(f)) ?? fs.readFileSync(f, 'utf8');
  const texto = h.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
  for (const [re, motivo] of SOSPECHAS_TEXTO) if (re.test(texto)) rotos.push(`${rel(f)}: ${motivo}`);
  for (const [re, motivo] of SOSPECHAS_HTML) if (re.test(h)) rotos.push(`${rel(f)}: ${motivo}`);
}

console.log(`${dry ? 'ENSAYO — no se ha escrito nada.\n' : ''}Páginas tocadas: ${tocadas}`);
console.log(`Afirmaciones eliminadas: ${borradas} · sustituidas por texto cierto: ${sustituidas}`);
if (sinEncontrar.length) {
  console.log(`\n⚠ ${sinEncontrar.length} siguen presentes (la cadena no encajó):`);
  sinEncontrar.slice(0, 8).forEach(x => console.log('   · ' + x));
}
if (rotos.length) {
  console.log(`\n⚠ POSIBLES DESTROZOS (${rotos.length}):`);
  [...new Set(rotos)].slice(0, 10).forEach(r => console.log('   · ' + r));
  process.exitCode = 1;
}
