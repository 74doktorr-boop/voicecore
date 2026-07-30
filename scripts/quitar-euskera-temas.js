#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   QUITAR EL EUSKERA DE LA COLA DEL BLOG
   ───────────────────────────────────────────────────────────────────────────
   El barrido de la web limpió lo que YA estaba publicado. Esto cierra la
   fábrica: `public/blog/topics.json` es la cola de temas del generador, que
   publica tres veces por semana sin que nadie lo mire. El campo `focus` no es
   una nota interna — es literalmente el prompt con el que se escribe el
   artículo. Mientras ahí ponga «atención en euskera», el generador seguirá
   produciendo la misma afirmación falsa indefinidamente.

   Quedan 52 temas por escribir. Cuatro afirmaban euskera, y dos de ellos son
   especialmente feos:

     · siete-mitos-ia-negocios-locales — el artículo se propone «desmontar CON
       DATOS» el mito «no habla mi idioma» citando «euskera y galego nativos».
       Un texto cuyo argumento entero es la honestidad, mintiendo en el séptimo
       punto.
     · guia-elegir-asistente-voz-negocio-2026 — es una lista de compra que le
       dice al lector qué exigirle a CUALQUIER proveedor. Incluía «idiomas
       incluidos euskera y galego»: le estaría dando al comprador un criterio
       que NodeFlow no cumple.

   Por qué valores literales y no expresiones regulares: son ocho textos. Un
   patrón que acierte en los ocho es más difícil de revisar que los ocho textos
   escritos. Y cada reemplazo se comprueba: si el texto de partida ya no es el
   que aquí figura, el script para en vez de escribir a ciegas.

   Lo que NO toca:
     · Los artículos ya publicados en disco. Esto es la cola, no el sitio.
       Sólo lo lee scripts/blog-gen.js (comprobado): ni el sitemap ni ninguna
       página dependen de este fichero.
     · Los dos temas cuya PREMISA es el euskera —recepcionista-virtual-euskera-
       nativo y recepcionista-ia-multiidioma-euskera-galego—. Ahí no cabe
       recortar una frase: o se reescribe el artículo o se retira, y los dos
       están indexados. Esa decisión es editorial, no de un script. Están ya en
       el manifiesto de publicados, así que el generador no los va a reescribir:
       son inertes, no una bomba.

   Uso:  node scripts/quitar-euskera-temas.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const FICHERO = path.join(__dirname, '..', 'public', 'blog', 'topics.json');
const dry = process.argv.includes('--dry');

// slug → { campo: [texto que debe estar ahora, texto nuevo] }
const CAMBIOS = {
  'recepcionista-ia-peluqueria-bilbao': {
    focus: [
      'Cómo una peluquería en Bilbao puede automatizar sus llamadas y citas con IA. Casos de uso, integración con Google Calendar, atención en euskera.',
      'Cómo una peluquería en Bilbao puede automatizar sus llamadas y citas con IA. Casos de uso, integración con Google Calendar, recuperación de huecos por cancelación.',
    ],
  },
  'recepcionista-ia-veterinaria-bilbao': {
    focus: [
      'Cómo las clínicas veterinarias de Bilbao y Bizkaia pueden gestionar urgencias, vacunaciones y citas de revisión automáticamente con IA en castellano y euskera.',
      'Cómo las clínicas veterinarias de Bilbao y Bizkaia pueden gestionar urgencias, vacunaciones y citas de revisión automáticamente con IA.',
    ],
  },
  'asistente-ia-clinica-dental-donostia': {
    focus: [
      'Cómo las clínicas dentales de Donostia-San Sebastián pueden reducir llamadas perdidas, automatizar triaje de urgencias y gestionar recordatorios con IA en euskera y castellano.',
      'Cómo las clínicas dentales de Donostia-San Sebastián pueden reducir llamadas perdidas, automatizar triaje de urgencias y gestionar recordatorios con IA.',
    ],
  },
  'asistente-ia-farmacia-donostia': {
    focus: [
      'Cómo las farmacias de Donostia pueden automatizar consultas de turno de guardia, disponibilidad y horarios en castellano y euskera con IA.',
      'Cómo las farmacias de Donostia pueden automatizar consultas de turno de guardia, disponibilidad y horarios con IA.',
    ],
  },
  'asistente-ia-taller-mecanico-donostia': {
    focus: [
      'Cómo los talleres mecánicos de Donostia pueden gestionar citas, presupuestos y llamadas de seguimiento automáticamente con IA en euskera y castellano.',
      'Cómo los talleres mecánicos de Donostia pueden gestionar citas, presupuestos y llamadas de seguimiento automáticamente con IA.',
    ],
  },
  // La lista de compra: le dice al lector qué exigir a cualquier proveedor.
  'guia-elegir-asistente-voz-negocio-2026': {
    focus: [
      'Checklist de compra: latencia inferior a un segundo, agenda unificada real (que consulte tu calendario, no una copia), idiomas incluidos euskera y galego, WhatsApp oficial verificado por Meta, RGPD y no-entrenamiento con tus datos, informe de resultados en euros y sin permanencia. Posicionar cada punto como pregunta que el lector debe hacer a cualquier proveedor, y responder cómo lo cumple NodeFlow.',
      'Checklist de compra: latencia inferior a un segundo, agenda unificada real (que consulte tu calendario, no una copia), tope de gasto que no se pueda saltar, registro consultable de lo que decidió la IA en cada llamada, WhatsApp oficial verificado por Meta, RGPD y no-entrenamiento con tus datos, informe de resultados en euros y sin permanencia. Posicionar cada punto como pregunta que el lector debe hacer a cualquier proveedor, y responder cómo lo cumple NodeFlow.',
    ],
  },
  // El artículo que se propone desmontar mitos con datos.
  'siete-mitos-ia-negocios-locales': {
    focus: [
      "Desmontar con datos los mitos: 'mis clientes colgarán a un robot' (voces naturales y latencia real), 'es caro' (49€/mes vs valor de una llamada), 'es complicado' (activo en minutos, sin hardware), 'la IA dirá barbaridades' (reglas de negocio fuera del LLM), 'mis datos entrenarán a otros' (compromiso de no-entrenamiento), 'quita trabajo a personas' (hace el trabajo que nadie hacía), 'no habla mi idioma' (euskera y galego nativos).",
      "Desmontar con datos los mitos: 'mis clientes colgarán a un robot' (voces naturales y latencia real), 'es caro' (49€/mes vs valor de una llamada), 'es complicado' (activo en minutos, sin hardware), 'la IA dirá barbaridades' (reglas de negocio fuera del LLM), 'mis datos entrenarán a otros' (compromiso de no-entrenamiento), 'quita trabajo a personas' (hace el trabajo que nadie hacía), 'se va a inventar cosas y no me voy a enterar' (cada decisión queda registrada y se puede repasar).",
    ],
  },
  // El tema sobrevive sin el euskera y sigue siendo cierto: al turista de
  // Biarritz o de un crucero se le atiende en francés y en inglés, que es lo
  // que de verdad no cubre un negocio pequeño de Donostia.
  'ia-multiidioma-turismo-pais-vasco': {
    title: [
      'IA multiidioma para negocios turísticos del País Vasco: euskera, castellano, inglés y francés',
      'IA multiidioma para negocios turísticos del País Vasco: castellano, inglés y francés',
    ],
    focus: [
      'Por qué los negocios turísticos del País Vasco necesitan IA que responda en euskera, castellano, inglés y francés. Restaurantes, hoteles y actividades ante turistas internacionales.',
      'Por qué los negocios turísticos del País Vasco necesitan IA que responda en castellano, inglés y francés. Restaurantes, hoteles y actividades ante turistas internacionales.',
    ],
  },
};

const temas = JSON.parse(fs.readFileSync(FICHERO, 'utf8'));
const errores = [];
let aplicados = 0;

for (const [slug, campos] of Object.entries(CAMBIOS)) {
  const tema = temas.find(t => t.slug === slug);
  if (!tema) { errores.push(`${slug}: ya no está en la cola`); continue; }
  for (const [campo, [antes, despues]] of Object.entries(campos)) {
    if (tema[campo] === despues) continue;            // ya aplicado
    if (tema[campo] !== antes) {                       // el texto ha cambiado
      errores.push(`${slug}.${campo}: el texto de partida no coincide, NO se toca`);
      continue;
    }
    tema[campo] = despues;
    aplicados++;
    console.log(`  ${dry ? '~' : '✓'}  ${slug}.${campo}`);
  }
}

// Red de seguridad: después de los cambios declarados, en la cola no puede
// quedar NINGÚN tema pendiente que mencione euskera. Si queda, es uno nuevo que
// nadie ha revisado, y se avisa en vez de dejarlo pasar en silencio.
const manifiesto = JSON.parse(fs.readFileSync(path.join(path.dirname(FICHERO), 'manifest.json'), 'utf8'));
const colados = temas
  .filter(t => !manifiesto.published.includes(t.slug))
  .filter(t => /euskera/i.test(JSON.stringify(t)))
  .map(t => t.slug);

if (!dry && aplicados) fs.writeFileSync(FICHERO, JSON.stringify(temas, null, 2) + '\n');
console.log(`\n${dry ? 'ENSAYO — no se ha escrito nada. ' : ''}Campos corregidos: ${aplicados}`);
if (errores.length) { console.log('\nSin aplicar:'); errores.forEach(e => console.log('   ·', e)); }
if (colados.length) {
  console.log(`\n⚠ Temas PENDIENTES que aún afirman euskera y no están declarados aquí:`);
  colados.forEach(s => console.log('   ·', s));
  process.exitCode = 1;
}
