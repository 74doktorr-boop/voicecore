#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   EL EUSKERA, SEGUNDA RONDA: LAS 168 MENCIONES QUE QUEDAN
   ───────────────────────────────────────────────────────────────────────────
   La primera ronda quitó lo que encajaba en un patrón: insignias, elementos de
   lista, tarjetas, preguntas del schema. Quedaron 168 menciones en 88 páginas
   repartidas en 149 frases distintas, y son las difíciles: párrafos de venta
   donde el euskera es un argumento dentro de una idea más larga.

   Y hay algo peor que reconocer: **la primera ronda dejó frases destrozadas**.
   Están publicadas ahora mismo:
     · «muchos alumnos prefieren recibir información en valoran que la
        autoescuela ofrezca esa opción desde el primer contacto»
     · «Sí. NodeFlow soporta castellanos.»
     · «. En euskera saluda y se despide en entiende a quien le hable en
        euskera; la voz vasca completa está en camino»
   Eso pasa por recortar una palabra en medio de una oración en vez de
   reescribir la oración entera. Aquí no se recorta nada: cada texto se
   sustituye por otro texto escrito a propósito, o se quita el bloque completo.

   CUATRO TRATAMIENTOS, según lo que sea la mención:

   1. BLOQUE ENTERO (preguntas frecuentes cuyo tema ES el euskera) → fuera, la
      pregunta y su respuesta. Recortarlas dejaría un «Sí.» colgando.

   2. ENCABEZADO (secciones de blog tituladas «Atención en euskera…») → se
      REESCRIBE el título, no se borra la sección. El cuerpo de esas secciones
      no habla de euskera —habla de integraciones, de recordatorios, de lo que
      sea—: el generador puso un título que no venía a cuento. Borrar la
      sección tiraría texto bueno; borrar sólo el <h2> dejaría párrafos
      huérfanos. Se cambia el título por uno que sí describa lo que hay debajo.

   3. FRASE (párrafos de venta) → se sustituye la oración entera por otra
      escrita a mano. La mayoría mejora al quitarle la coletilla: «gestiona
      citas y envía recordatorios — en castellano y euskera. Sin que el
      fisioterapeuta suelte al paciente» funciona igual sin el inciso.

   4. METADATOS (description, keywords, og, schema) → el schema se PARSEA, no
      se toca con expresiones regulares: un JSON-LD inválido no falla de forma
      visible, Google descarta el schema de la página entera en silencio.

   NO SE TOCA: `guard/index.html` (allí el euskera es cierto: la app del
   vigilante está traducida entera y hay tests que lo garantizan) ni
   `blog/retirado.html` (explica precisamente por qué se retiró lo otro).

   Uso:  node scripts/euskera-ronda-2.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const EXCLUIR_DIR = new Set(['admin', 'hementxe']);
const INTOCABLES = new Set([
  // El euskera es CIERTO aquí: la app del vigilante de Guard está traducida
  // entera y hay tests en su repo que fallan si una frase se queda sin traducir.
  'guard/index.html',
  // Y aquí se explica precisamente por qué se retiró lo demás.
  'blog/retirado.html',
]);

// Menciones que se QUEDAN a propósito, con su motivo. No es lo mismo «queda una
// pendiente» que «queda una decidida»: lo primero es deuda, lo segundo es una
// postura. Declararlo evita que la próxima pasada lo trate como olvido.
const DECLARADAS = new Map([
  ['blog/ia-voz-para-negocios-espana-tendencias-2026/index.html',
   'Análisis del sector, no promesa nuestra: dice que el euskera, el gallego y ' +
   'el catalán tienen calidad desigual en el mercado. Es verdad, y va seguido ' +
   'de lo que NodeFlow sí hace. Reconocer un límite del sector vende más que ' +
   'esconderlo.'],
]);
const dry = process.argv.includes('--dry');

// ── 1. BLOQUES QUE DESAPARECEN ENTEROS ────────────────────────────────────
// Pregunta frecuente cuyo tema es el euskera: se va la pregunta y la
// respuesta. La plantilla es <div class="faq-item" …><div class="faq-q">…
// </div><div class="faq-a">…</div></div>, y el bloque se cierra en el primer
// </div></div> tras la respuesta.
const BLOQUES = [
  [/\s*<div class="faq-item"[^>]*>\s*<div class="faq-q">[^<]*[Ee]uskera[^<]*<span[^>]*>[^<]*<\/span><\/div>\s*<div class="faq-a">[\s\S]*?<\/div>\s*<\/div>/g, ''],
  // La misma pregunta en plantillas sin el <span> del icono
  [/\s*<div class="faq-item"[^>]*>\s*<div class="faq-q">[^<]*[Ee]uskera[^<]*<\/div>\s*<div class="faq-a">[\s\S]*?<\/div>\s*<\/div>/g, ''],
  // Preguntas frecuentes con <details><summary>
  [/\s*<details[^>]*>\s*<summary[^>]*>[^<]*[Ee]uskera[^<]*<\/summary>[\s\S]*?<\/details>/g, ''],
  // TERCERA plantilla, con microdatos: <div class="faq-item" itemscope …
  // Question><button class="faq-q"…><span itemprop="name">PREGUNTA</span>…
  // Hay tres formas distintas de escribir una pregunta frecuente en este sitio
  // y sólo se ven yendo a mirar página por página: la primera pasada cubrió
  // dos y dejó 17 páginas intactas creyendo que ya estaba.
  [/\s*<div class="faq-item" itemscope[^>]*>\s*<button class="faq-q"[^>]*>\s*<span itemprop="name">[^<]*[Ee]uskera[^<]*<\/span>[\s\S]*?<\/div>\s*<\/div>/g, ''],
  // PREGUNTAS SIN PREGUNTA. La primera ronda borró el <span itemprop="name">
  // de estas y dejó el resto: un desplegable con su «+», sin texto, y debajo
  // una respuesta sobre el euskera. Están publicadas así ahora mismo. El
  // patrón las reconoce por lo que les FALTA: un faq-item cuyo botón no tiene
  // nombre. Se va el bloque entero, que es lo que debió pasar la primera vez.
  [/\s*<div class="faq-item" itemscope[^>]*>\s*<button class="faq-q"(?:(?!<\/button>)[\s\S])*?<\/button>\s*<div class="faq-a"[^>]*>\s*<p itemprop="text">[^<]*[Ee]uskera[\s\S]*?<\/div>\s*<\/div>/g, ''],
];

// ── 0. REPARAR JSON-LD QUE YA VENÍA ROTO ──────────────────────────────────
// Se aplica ANTES de limpiar el schema, porque limpiarSchema no toca lo que no
// puede parsear. Este bloque lleva inválido desde que se publicó: la respuesta
// mete comillas rectas dentro de una cadena JSON («llamadas diarias de "¿están
// de guardia?"»). Google no avisa de esto: descarta en silencio el schema de
// TODA la página, así que lleva meses sin estrellas ni desplegable de
// preguntas en el buscador y nadie se ha enterado.
const REPARAR = [
  ['llamadas diarias de "¿están de guardia?", el ahorro',
   'llamadas diarias de «¿están de guardia?», el ahorro'],
];

// ── 2. ENCABEZADOS QUE SE REESCRIBEN ──────────────────────────────────────
// Cada uno aparece dos veces: en el índice de contenidos y en el <h2>. Como
// el texto es idéntico, una sola sustitución global arregla los dos.
const ENCABEZADOS = [
  ['Atención en euskera: esencial en los barrios de Bilbao',
   'Se conecta con la agenda que el negocio ya usaba'],
  ['Clientes que prefieren hablar en euskera',
   'Clientes que llaman fuera de horario'],
  ['Clientes que prefieren el euskera',
   'Clientes que llaman cuando no hay nadie'],
  ['Gestión de Recordatorios en Euskera y Castellano',
   'Recordatorios que evitan el plantón'],
  ['Atención Personalizada en Euskera y Español',
   'Atención que reconoce al cliente que ya vino'],
  ['De Vitoria al mundo: la IA que habla euskera',
   'De Vitoria al mundo: la IA que no deja una llamada sin coger'],
  ['¿Tu farmacia en Donostia necesita atención 24/7 en euskera?',
   '¿Tu farmacia en Donostia necesita atender el teléfono 24/7?'],
  ['¿Incluye Idiomas como Euskera y Galego?',
   '¿En qué idiomas atiende?'],

  // — LA PROMESA SIN LA PALABRA. Estos encabezados no dicen «euskera», así que
  //   ningún recuento de esa palabra los ve, pero prometen exactamente lo
  //   mismo: «atención bilingüe obligatoria», «asistente bilingüe para una
  //   ciudad bilingüe». En una ciudad vasca, bilingüe significa una cosa. Se
  //   descubrieron leyendo páginas ya «limpias», no contando. —
  ['Las farmacias donostiarras: alta demanda y atención bilingüe obligatoria',
   'Las farmacias donostiarras: mucha llamada y pocas manos para cogerla'],
  ['IA que atiende en castellano: imprescindible en Donostia',
   'Atender el teléfono cuando el mostrador está lleno'],
  ['Asistente Bilingüe para una Ciudad Bilingüe',
   'Un asistente que no deja sonar el teléfono'],
  ['Ventajas de un Asistente Virtual Bilingüe en Vitoria',
   'Ventajas de un asistente virtual en Vitoria'],
  ['Beneficios de un Recepcionista Virtual Bilingüe para Clínicas',
   'Beneficios de un recepcionista virtual para clínicas'],
  ['Clientes euskaldunes exigentes',
   'Clientes que no esperan al teléfono'],
];

// ── 3. FRASES: oración entera por oración entera ─────────────────────────
// Escritas a mano. El criterio: si la frase mejora quitando el inciso del
// idioma, se quita; si el idioma era el argumento, se cambia el argumento por
// otro que sí sea cierto (tope de gasto, registro revisable, 24/7).
const FRASES = [
  // — PRIMERO las que arrastran el signo de puntuación que las precede. Van
  //   antes que las genéricas a propósito: si no, la genérica se lleva sólo la
  //   coletilla y deja «…vacunaciones,.» o «…servicios —.». Se descubrió
  //   midiendo el resultado, no leyéndolo. —
  [/,\s*en castellano y euskera\./g, '.'],
  [/,\s*en castellano y en euskera\./g, '.'],
  [/\s*—\s*y habla euskera\./g, '.'],
  [/\s*—\s*y habla euskera nativo\./g, '.'],

  // — Coletillas de las páginas de sector (las más repetidas) —
  [/,?\s*y habla euskera con tus clientes\b/g, ''],
  [/,?\s*y habla euskera nativo\b/g, ''],
  [/,?\s*y habla euskera\b/g, ''],
  [/,?\s*habla euskera nativo\.\s*/g, ' '],
  [/\s*—\s*en castellano y en euskera\./g, '.'],
  [/\s*—\s*en castellano y euskera\./g, '.'],
  [/\s*en castellano y en euskera\./g, '.'],
  [/\s*En castellano y euskera, disponible 24\/7\./g, ' Disponible 24/7.'],
  [/\s*en castellano y euskera\.\s*Las 24 horas/g, '. Las 24 horas'],
  [/\s*en castellano y euskera\./g, '.'],
  [/\s*En castellano y euskera\./g, ''],
  [/\s*Atención en castellano y euskera 24\/7\./g, ' Atención 24/7, sin espera.'],
  [/\s*Euskera nativo\.\s*/g, ' '],
  [/,\s*habla euskera\./g, '.'],

  // — Metadatos: la palabra clave entera fuera de la lista —
  [/,\s*IA [^,"]*euskera[^,"]*(?=,)/g, ''],
  [/,\s*IA euskera [^,"]*(?=,)/g, ''],

  // — Restos ROTOS que dejó la primera ronda. Se reescriben enteros. —
  [/\.\s*En euskera saluda y se despide en entiende a quien le hable en euskera;\s*la voz vasca completa está en camino/g,
   '. Detecta el idioma del cliente y responde en el mismo'],
  [/Sí\. NodeFlow soporta castellanos\./g,
   'Sí. NodeFlow atiende en castellano, y también en inglés y francés si lo necesitas.'],
  [/muchos alumnos prefieren recibir información en valoran que la autoescuela ofrezca esa opción desde el primer contacto\./g,
   'muchos alumnos valoran que la autoescuela responda a la primera, sin buzón de voz.'],

  // — Párrafos de venta, uno a uno —
  [/En Andoain el porcentaje de euskaldunes es alto\. Un asistente que no entiende euskera o que suena artificial pierde a esos clientes antes de que reserven\./g,
   'En Andoain mucha gente llama al salir del trabajo, cuando el negocio ya ha cerrado. Un asistente que coge el teléfono a esa hora reserva citas que hoy se pierden.'],
  [/En Donostia el porcentaje de euskaldunes es muy alto\. Un asistente que no habla euskera o que suena artificial da mala imagen\. La voz vasca completa está en camino\./g,
   'En Donostia el teléfono suena a la hora peor: con el local lleno. Un asistente que atiende sin hacer esperar evita que el cliente cuelgue y llame al de al lado.'],
  [/Bilbao tiene una comunidad euskaldun creciente\. Un asistente que suena natural en euskera es una ventaja competitiva real — no un capricho cultural\./g,
   'En Bilbao el cliente que no consigue que le cojan el teléfono llama al siguiente de la lista. Un asistente que responde al segundo tono es una ventaja competitiva real — no un adorno.'],
  [/El asistente atiende, reserva en tu Google Calendar y te manda el resumen por WhatsApp\. En euskera o castellano según el cliente\./g,
   'El asistente atiende, reserva en tu Google Calendar y te manda el resumen por WhatsApp. Con la transcripción entera, por si quieres repasarla.'],
  [/El asistente atiende, reserva en tu Google Calendar y te manda el resumen por WhatsApp\. En euskera, castellano o inglés según el cliente\./g,
   'El asistente atiende, reserva en tu Google Calendar y te manda el resumen por WhatsApp. En castellano o en inglés, según el cliente.'],
  [/Castellano y euskera de forma automática\. Amplía tu mercado sin barrera de idioma\./g,
   'Castellano, inglés y francés de forma automática. Amplía tu mercado sin barrera de idioma.'],
  [/La gente cuelga a los robots en 6 segundos\. A NodeFlow no: voz natural, respuesta en menos de un segundo y hasta euskera y galego nativos\. Así se hace\./g,
   'La gente cuelga a los robots en 6 segundos. A NodeFlow no: voz natural, respuesta en menos de un segundo y galego nativo. Así se hace.'],
  [/Para un cliente mayor que toda la vida ha hablado euskera con su peluquera, que la «máquina» le conteste en su idioma no es un detalle técnico: es la diferencia entre confiar y colgar\. Los negocios lo saben, y por eso es una de las funciones más queridas del producto\./g,
   'Para un cliente mayor, que la «máquina» le diga desde el principio que es una máquina, y aun así le entienda y le dé cita, no es un detalle técnico: es la diferencia entre confiar y colgar. Por eso el asistente avisa siempre de que es una IA.'],
  [/háblale en euskera a mitad de conversación\. Está acostumbrado\./g,
   'cámbiale el idioma a mitad de conversación. Está acostumbrado.'],

  // — Párrafos de blog. El turismo es el caso donde SÍ hay un argumento
  //   verdadero que poner en su sitio: al viajero de Biarritz o del crucero se
  //   le atiende en francés e inglés, y eso el producto lo hace de verdad.
  [/En el País Vasco, donde el turismo interior en euskera también tiene peso, NodeFlow puede atender en esa lengua a viajeros locales que se sientan más cómodos en su idioma materno, reforzando el vínculo emocional con la agencia\./g,
   'En el País Vasco, donde buena parte del viajero llega de Francia o de un crucero, NodeFlow atiende en inglés y en francés sin que la agencia tenga que contratar a nadie para esas horas.'],
  [/NodeFlow es bilingüe, soportando tanto el español como el euskera, ideal para la diversidad lingüística en San Sebastián\./g,
   'NodeFlow atiende en castellano, inglés y francés, útil en una ciudad como San Sebastián donde media consulta de verano llega de fuera.'],
  [/Bilbao es una ciudad multilingüe\. NodeFlow atiende en castellano y euskera de forma nativa, sin acentos artificiales ni confusiones culturales\./g,
   'Bilbao es una ciudad multilingüe. NodeFlow atiende en castellano, inglés y francés, sin acentos artificiales ni confusiones culturales.'],
  [/Vitoria es una ciudad multicultural, y ofrecer un servicio bilingüe puede marcar la diferencia\. NodeFlow es capaz de comunicarse en español y euskera, asegurando que todos tus clientes se sientan valorados y comprendidos\./g,
   'Vitoria es una ciudad multicultural, y ofrecer un servicio en varios idiomas puede marcar la diferencia. NodeFlow se comunica en castellano, inglés y francés, para que ningún cliente se quede sin que le entiendan.'],
  [/Sí, NodeFlow ofrece asistencia en español y euskera, lo que es perfecto para la clientela multicultural de Vitoria-Gasteiz\./g,
   'Sí, NodeFlow atiende en castellano, inglés y francés, lo que encaja con la clientela multicultural de Vitoria-Gasteiz.'],
  [/IA que gestiona citas y presupuestos telefónicos en castellano y euskera/g,
   'IA que gestiona citas y presupuestos telefónicos sin dejar una llamada sin coger'],

  // — El artículo de tendencias hablaba del euskera como reto técnico
  //   PENDIENTE. Era lo más honesto de toda la web sobre el tema, pero decía
  //   «la aproximación de NodeFlow para el euskera» como si existiera. Se
  //   reescribe dejando el análisis del sector y quitándonos a nosotros.
  [/La primera es la calidad en idiomas regionales\. El castellano neutro funciona excelentemente, pero el euskera, el gallego y el catalán tienen niveles de calidad desiguales\. Las soluciones basadas en voces clonadas de locutores nativos —como la aproximación de NodeFlow para el euskera— son superiores a las de síntesis genérica, pero requieren una inversión mayor\. Es un reto técnico activo, no un problema resuelto al 100%\./g,
   'La primera es la calidad en idiomas regionales. El castellano neutro funciona excelentemente, pero el euskera, el gallego y el catalán tienen niveles de calidad desiguales. Las voces clonadas de locutores nativos son superiores a la síntesis genérica, pero exigen una inversión mucho mayor. Es un reto técnico abierto, no un problema resuelto: NodeFlow, hoy, atiende en castellano, galego, inglés y francés.'],
  [/La tercera es la mejora continua de los idiomas regionales\. La presión del mercado en el País Vasco, Galicia y Cataluña está impulsando inversiones en voces en euskera, gallego y catalán de calidad genuinamente humana\. En dos años, la diferencia de calidad entre castellano e idiomas regionales debería ser marginal\./g,
   'La tercera es la mejora continua de los idiomas regionales. La presión del mercado en el País Vasco, Galicia y Cataluña está impulsando inversiones en voces de calidad genuinamente humana. En dos años, la diferencia con el castellano debería ser marginal.'],
  [/En 2026, sí existen soluciones funcionales para ambas lenguas\. NodeFlow trabaja con voces clonadas de locutores vascos nativos para ofrecer un euskera que suena natural, no una traducción robótica\./g,
   'En 2026 el galego funciona con voces naturales. El euskera sigue siendo terreno de proyectos abiertos, y ninguna solución del mercado —la nuestra tampoco— lo resuelve todavía a un nivel que aguante una llamada real de principio a fin.'],
  [/\(2\) Idiomas soportados — fundamental si necesitas euskera, gallego o catalán;/g,
   '(2) Idiomas soportados — pregunta cuáles cubre DE VERDAD y pide oírlos, no una lista en una web;'],
  [/¿El asistente IA puede manejar llamadas en euskera o gallego\?/g,
   '¿En qué idiomas atiende de verdad?'],
  [/respondiendo en castellano y euskera con naturalidad/g,
   'respondiendo con naturalidad y sin hacer esperar'],
  [/en castellano y euskera con naturalidad/g, 'en castellano con naturalidad'],
  [/respondiendo en castellano y euskera con el tono formal/g,
   'respondiendo con el tono formal'],

  // — Las últimas nueve, una a una. Aquí ya no hay patrón: cada una es una
  //   idea distinta dentro de un párrafo distinto. —
  [/La disponibilidad 24\/7 —esencial en situaciones de urgencia legal— y la atención en euskera son diferenciadores clave frente a despachos más tradicionales\./g,
   'La disponibilidad 24/7 —esencial en situaciones de urgencia legal— y la discreción con que se recogen los datos del caso son diferenciadores clave frente a despachos más tradicionales.'],
  [/Además, en un entorno bilingüe como el de San Sebastián, es crucial contar con una herramienta que gestione eficazmente tanto en euskera como en castellano\./g,
   'Además, en una ciudad con tanto visitante como San Sebastián, es útil contar con una herramienta que atienda también en inglés y en francés.'],
  [/Donostia-San Sebastián tiene una demografía lingüística particular: una parte significativa de sus clientes prefiere ser atendida en euskera\. Para una farmacia en el Casco Viejo o en Gros, tener un asistente que detecte automáticamente el idioma y responda con naturalidad no es un lujo — es una expectativa\./g,
   'Una farmacia del Casco Viejo o de Gros recibe llamadas a todas horas para lo mismo: si está de guardia, hasta cuándo abre, si tiene un medicamento. Que alguien conteste eso al instante, y a las once de la noche, no es un lujo — es lo que el cliente da por hecho.'],
  [/Todo en castellano o euskera, con un tono cálido y profesional que refleja los valores de tu consulta\./g,
   'Todo con un tono cálido y profesional que refleja los valores de tu consulta.'],
  [/Vitoria-Gasteiz es la capital de Álava y sede de muchas instituciones bilingües\. NodeFlow atiende en castellano y euskera, lo que refuerza el vínculo con la comunidad local y diferencia tu clínica de las que solo ofrecen servicio en castellano\./g,
   'Vitoria-Gasteiz concentra muchas consultas fuera del horario de oficina, cuando el dueño del animal sale de trabajar. NodeFlow atiende a esa hora y deja la cita puesta, que es cuando las clínicas pierden pacientes sin enterarse.'],
  [/Imagina un sistema que no solo maneja llamadas, sino que también gestiona las reservas, todo esto hablando en euskera si el cliente lo prefiere\./g,
   'Imagina un sistema que no solo maneja llamadas, sino que además deja la cita puesta en la agenda que ya usas y te manda el resumen por WhatsApp.'],
  [/En Bizkaia, ofrecer atención en euskera puede marcar la diferencia\. NodeFlow entiende la importancia de la personalización y ofrece un sistema que se comunica de manera fluida en ambos idiomas\. Esto no solo mejora la experiencia del cliente, sino que también amplía tu alcance a un público más diverso\. Imagina que un cliente llama y es atendido inmediatamente en su idioma preferido; esto genera confianza y fidelidad\./g,
   'En Bizkaia, que te cojan el teléfono a la primera marca la diferencia. NodeFlow reconoce al cliente que ya vino por su número y recupera su ficha antes de la segunda frase, así que no hay que empezar de cero cada vez. Un cliente atendido al instante y sin repetir sus datos vuelve.'],
  [/NodeFlow permite la gestión de citas tanto en castellano como en euskera, asegurando que todos tus clientes se sientan atendidos y comprendidos\./g,
   'NodeFlow gestiona las citas y distingue una urgencia de una revisión, para que lo que no puede esperar no se quede en un buzón de voz.'],
  [/NodeFlow permite que tu clínica ofrezca atención al cliente tanto en castellano como en euskera, lo que amplía tu base de clientes potenciales y mejora la accesibilidad de tu servicio\./g,
   'NodeFlow permite que tu clínica atienda a cualquier hora, también fuera del horario de consulta, lo que amplía tu base de clientes potenciales y mejora la accesibilidad de tu servicio.'],

  // — Y esto NO es un problema de idioma: es un CLIENTE INVENTADO con una
  //   métrica inventada. «La Clínica VetBilbao implementó NodeFlow y vio un
  //   aumento del 15%». No existe. En una empresa que vende que no se inventa
  //   nada, un testimonio falso hace más daño que la promesa del euskera. —
  // — LA PROMESA SIN LA PALABRA. Ninguna de estas seis dice «euskera», así que
  //   ningún recuento de esa palabra las veía, y prometen lo mismo. Dos traen
  //   además regalo: una frase que la primera ronda partió («donde el el
  //   español coexisten») y otra métrica inventada. —
  [/En un ambiente bilingüe como el de San Sebastián, la capacidad de NodeFlow para operar en castellano es una ventaja añadida, asegurando comunicación efectiva con todos los pacientes\./g,
   'Y cada decisión del triaje queda escrita, así que se puede repasar por qué el asistente marcó un caso como urgente y otro no.'],
  [/Además, su capacidad para operar en varios idiomas es perfecta para una ciudad bilingüe como San Sebastián\. Vamos a ver cómo esto puede transformar tu clínica\./g,
   'Además, atiende también en inglés y en francés, algo que en San Sebastián se nota en cuanto empieza la temporada. Vamos a ver cómo esto puede transformar tu clínica.'],
  [/San Sebastián es una ciudad donde el el español coexisten\. Tener un asistente IA bilingüe no es solo una ventaja, es casi una necesidad\. NodeFlow ofrece esta capacidad, permitiendo que los pacientes se comuniquen en el idioma que prefieran\./g,
   'San Sebastián recibe visitantes todo el año. Un asistente que atienda también en inglés y en francés no es un lujo: es la diferencia entre coger esa llamada o perderla. NodeFlow lo hace sin que la clínica contrate a nadie para esas horas.'],
  [/Esto no solo mejora la comodidad del paciente, sino que también puede aumentar la base de clientes, ya que te hace accesible a una audiencia más amplia\. Las clínicas que ofrecen servicios bilingües han visto un aumento del 20% en nuevos pacientes\./g,
   'Esto no solo mejora la comodidad del paciente, sino que también puede aumentar la base de clientes, ya que te hace accesible a una audiencia más amplia. No damos un porcentaje: cada clínica lo mide en su propio panel, llamada a llamada.'],
  [/Además, con su capacidad bilingüe, la barrera del idioma ya no es un problema en una ciudad tan multicultural como Vitoria\./g,
   'Además, atiende también en inglés y en francés, así que la barrera del idioma deja de ser un problema en una ciudad tan multicultural como Vitoria.'],
  [/En una región bilingüe como Bilbao y Bizkaia, ofrecer servicios en varios idiomas es crucial\./g,
   'En Bilbao y Bizkaia, la llamada que no se coge se la queda la clínica de al lado.'],

  [/Por ejemplo, la Clínica VetBilbao implementó NodeFlow y vio un aumento del 15% en nuevos clientes del área donde el euskera es la lengua predominante\. Esto demuestra que un enfoque bilingüe no solo es beneficioso, sino esencial para el crecimiento en esta región\./g,
   'No publicamos porcentajes de clientes que no podemos enseñar. Lo que sí se puede comprobar antes de contratar: cada llamada queda con su transcripción y su resultado en el panel, así que el efecto se mide sobre las llamadas propias, no sobre un caso de éxito de un folleto.'],
];

/**
 * Quita del JSON-LD las preguntas sobre euskera y limpia las descripciones,
 * PARSEANDO el bloque. Un JSON-LD inválido no falla de forma visible: Google
 * descarta el schema de TODA la página en silencio y se pierden las estrellas
 * y el desplegable de preguntas del buscador.
 */
function limpiarSchema(html, avisos, rel) {
  return html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (todo, cuerpo) => {
    if (!/euskera/i.test(cuerpo)) return todo;
    let datos;
    try { datos = JSON.parse(cuerpo); }
    catch { avisos.push(`${rel}: el JSON-LD ya venía inválido, no se toca`); return todo; }

    let tocado = false;
    const podar = (n) => {
      if (Array.isArray(n)) { n.forEach(podar); return; }
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.mainEntity)) {
        const antes = n.mainEntity.length;
        n.mainEntity = n.mainEntity.filter(q => !/euskera/i.test(JSON.stringify(q)));
        if (n.mainEntity.length !== antes) tocado = true;
      }
      // Descripciones y palabras clave dentro del propio schema
      for (const campo of ['description', 'keywords', 'headline', 'name']) {
        if (typeof n[campo] === 'string' && /euskera/i.test(n[campo])) {
          const nuevo = aplicarFrases(n[campo]);
          if (nuevo !== n[campo]) { n[campo] = nuevo; tocado = true; }
        }
      }
      Object.values(n).forEach(podar);
    };
    podar(datos);
    if (!tocado) return todo;
    return `<script type="application/ld+json">\n${JSON.stringify(datos, null, 2)}\n  </script>`;
  });
}

function aplicarFrases(s) {
  for (const [re, a] of FRASES) s = s.replace(re, a);
  return s;
}

// ── Recorrido ─────────────────────────────────────────────────────────────
function rec(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!EXCLUIR_DIR.has(e.name)) rec(path.join(dir, e.name), acc); }
    else if (e.name.endsWith('.html')) acc.push(path.join(dir, e.name));
  }
  return acc;
}

let tocadas = 0, rotos = [], avisos = [], sinPatron = [];
// Resultado en memoria. Las comprobaciones del final se hacen sobre ESTO y no
// sobre el disco: en ensayo el disco no ha cambiado, así que medirlo daría
// siempre el estado de partida y el informe mentiría diciendo que no se ha
// arreglado nada.
const resultado = new Map();
for (const f of rec(PUBLIC, [])) {
  const rel = path.relative(PUBLIC, f).split(path.sep).join('/');
  if (INTOCABLES.has(rel)) continue;
  const antes = fs.readFileSync(f, 'utf8');
  // La puerta NO puede ser sólo la palabra «euskera». La primera ronda dejó la
  // promesa sin la palabra —«atención bilingüe obligatoria», «asistente
  // bilingüe para una ciudad bilingüe»— y esas páginas no entraban aquí, así
  // que se quedaban tal cual mientras el recuento decía que estaban limpias.
  if (!/euskera|bilingüe|euskaldun|vascoparlante/i.test(antes)) continue;

  let s = antes;
  for (const [de, a] of REPARAR) s = s.split(de).join(a);
  s = limpiarSchema(s, avisos, rel);
  for (const [re, a] of BLOQUES) s = s.replace(re, a);
  for (const [de, a] of ENCABEZADOS) s = s.split(de).join(a);
  s = aplicarFrases(s);

  if (s === antes) {
    // Sólo cuenta como «sin patrón» si la mención la ve alguien. Varias son
    // comentarios míos explicando por qué se retiró el euskera.
    if (/euskera/i.test(antes.replace(/<!--[\s\S]*?-->/g, ''))) sinPatron.push(rel);
    continue;
  }
  resultado.set(rel, s);

  for (const m of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { rotos.push(`${rel}: ${e.message.slice(0, 60)}`); }
  }
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
}

// ── Recuento y control de destrozos ───────────────────────────────────────
// Lo que de verdad importa no es cuántas menciones quedan: es si al quitarlas
// se han fabricado frases sin sentido, que es lo que pasó en la primera ronda
// y nadie vio hasta hoy.
// El `(?!\.)` no es un detalle: sin él, «pierde algo de peso y...» —puntos
// suspensivos puestos a propósito— se denuncia como frase rota. Un detector con
// falsos positivos se acaba ignorando, y entonces ya no detecta nada.
const SOSPECHAS = [
  [/\s+en\s*\.(?!\.)/g, '«… en .» — preposición huérfana'],
  [/\s+y\s*\.(?!\.)/g, '«… y .» — conjunción huérfana'],
  [/,\s*\.(?!\.)/g, '«, .» — coma antes de punto'],
  [/\s+—\s*\.(?!\.)/g, '«— .» — inciso vacío'],
  [/\bcastellanos\b/g, '«castellanos» — plural imposible'],
  [/\ben\s+valoran\b/g, 'frase partida («en valoran»)'],
  // NO se comprueban «espacios múltiples»: al quitar las etiquetas queda la
  // sangría del HTML y salta en las 178 páginas. Un chivato que salta siempre
  // no avisa de nada; sólo tapa a los que sí importan.
];
let quedan = 0; const paginasConMencion = new Set(); const destrozos = [];
for (const f of rec(PUBLIC, [])) {
  const rel = path.relative(PUBLIC, f).split(path.sep).join('/');
  if (INTOCABLES.has(rel)) continue;
  const bruto = resultado.get(rel) ?? fs.readFileSync(f, 'utf8');
  // Los comentarios HTML no los ve nadie: varios son los que dejé yo
  // explicando POR QUÉ se retiró el euskera. Contarlos como si fueran una
  // promesa al cliente falsearía el recuento en la dirección que me conviene.
  const h = bruto.replace(/<!--[\s\S]*?-->/g, '');
  const n = (h.match(/euskera/gi) || []).length;
  if (n) { quedan += n; paginasConMencion.add(rel); }
  // Sólo se mira el TEXTO visible: en el CSS y el JS los espacios múltiples
  // y los signos sueltos son normales.
  const texto = h.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
  for (const [re, motivo] of SOSPECHAS) {
    if (re.test(texto)) destrozos.push(`${rel}: ${motivo}`);
  }
}

const pendientes = [...paginasConMencion].filter(p => !DECLARADAS.has(p));
console.log(`${dry ? 'ENSAYO — no se ha escrito nada.\n' : ''}Páginas modificadas: ${tocadas}`);
console.log(`Menciones que quedan: ${quedan} · declaradas a propósito: ${[...DECLARADAS.keys()].filter(k => paginasConMencion.has(k)).length} · SIN DECIDIR: ${pendientes.length}`);
for (const [p, motivo] of DECLARADAS) {
  if (paginasConMencion.has(p)) console.log(`   ✓ ${p}\n     ${motivo}`);
}
const huerfanos = sinPatron.filter(p => !DECLARADAS.has(p));
if (huerfanos.length) {
  console.log(`\nMencionan euskera y NINGÚN patrón encaja (${huerfanos.length}):`);
  huerfanos.slice(0, 12).forEach(p => console.log('   · ' + p));
}
if (avisos.length) { console.log('\nAvisos:'); [...new Set(avisos)].slice(0, 6).forEach(a => console.log('   · ' + a)); }
if (destrozos.length) {
  console.log(`\n⚠ POSIBLES FRASES DESTROZADAS (${destrozos.length}):`);
  [...new Set(destrozos)].slice(0, 12).forEach(d => console.log('   · ' + d));
}
if (rotos.length) {
  console.log(`\n⚠ JSON-LD ROTO en ${rotos.length} páginas:`);
  rotos.slice(0, 5).forEach(r => console.log('   · ' + r));
  process.exitCode = 1;
}
