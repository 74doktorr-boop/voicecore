#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   UNIFICAR LA MARCA EN LAS LANDINGS DE SECTOR Y CIUDAD
   ───────────────────────────────────────────────────────────────────────────
   Por qué existe: al auditar la web salió que NodeFlow no tiene una identidad,
   tiene TRES. Las 45 landings de sector y ciudad —que son las puertas de
   entrada del SEO— cargan Fraunces + Inter desde Google, pintan sobre un
   marrón #0c0a08 y usan dorado #e0a23c y turquesa #00cec9 como acentos.
   El lima de la marca NO APARECE en ellas. Quien llega desde Google aterriza
   en algo que parece otra empresa, y luego pasa a /recepcion, que es otra
   distinta.

   Qué hace: migra tipografía y paleta al sistema de la marca, y añade lo que
   les falta a las 42 de 43 que no tienen NI UNA imagen: una captura real del
   producto. Es sistemático a propósito — 45 páginas no se arreglan a mano.

   Qué NO toca, a propósito: el texto, las FAQ, el schema ni la estructura.
   Cada landing tiene contenido propio de su oficio («¿puede avisar al cliente
   cuando su coche está listo?») y eso es lo bueno que ya tienen. Aquí sólo se
   unifica la piel.

   Uso:
     node scripts/unificar-marca-landings.js --dry            (ensayo, no toca)
     node scripts/unificar-marca-landings.js --solo clinicas  (una, para probar)
     node scripts/unificar-marca-landings.js                  (todas)
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
// Carpetas que NO son landings: tienen su propia identidad o su propio ciclo.
// hementxe es OTRA MARCA (empresa aparte): queda fuera de los barridos de
// NodeFlow a propósito. blog/portal/admin tienen su propio ciclo.
// El blog entra en los barridos de COLOR (su generador ya está migrado, pero
// los 102 posts publicados llevan los colores viejos en formato rgba).
const EXCLUIR = new Set(['portal', 'admin', 'hementxe']);
// Las legales SÍ se unifican de marca —tienen que parecer de la misma casa—
// pero NO llevan captura del producto: una pantalla de ventas en mitad de la
// política de privacidad es exactamente lo que nadie quiere encontrarse.
// Y tampoco las de sistema: un 404 o un formulario de alta con una pantalla
// de ventas encajada en medio es lo contrario de ayudar.
const SIN_CAPTURA = new Set(['privacidad', 'terminos', 'condiciones', 'aviso-legal', 'gracias', 'status', 'guias',
  '404', 'docs', 'onboarding', 'demo', '_landing-v3', 'index-old']);

// ── Tipografía ────────────────────────────────────────────────────────────
const FUENTES_MARCA =
  '<link rel="preconnect" href="https://api.fontshare.com" crossorigin>\n' +
  '<link href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet">';

// ── Paleta: de la suya a la de la marca ───────────────────────────────────
// El orden importa: los valores más largos primero para que no se pisen.
const COLORES = [
  ['#0c0a08', '#0F110C'],   // fondo: marrón  → grafito cálido
  ['#141009', '#141810'],   // fondo 2
  ['#14141e', '#191E14'],   // tarjeta: azulada → verde grafito
  ['#1c1c28', '#1F251A'],   // tarjeta al pasar
  ['#e8e8f0', '#EEF3E4'],   // texto: azulado → blanco cálido
  ['#8888a8', '#818B76'],   // texto apagado
  // OJO: --muted se usaba 7 veces como COLOR DE TEXTO, no como borde. Con un
  // tono de borde quedaba en 1,41:1, o sea invisible. Va al gris de texto de
  // la marca (5,32:1). Lo cazó la medición de contraste, no la vista.
  ['#3a3a52', '#818B76'],   // texto apagado
  ['#e0a23c', '#c4f546'],   // ACENTO: dorado → lima de la marca
  ['#f2bd5e', '#A8DC2A'],   // acento claro
  ['#00cec9', '#c4f546'],   // "verde" turquesa → lima
  ['#feca57', '#E8B84B'],   // amarillo → ámbar semántico (pendiente)
  ['#ff6b6b', '#ff6f5e'],   // rojo → el rojo de la marca
];

// Los mismos colores viven TAMBIÉN en formato rgb/rgba, dentro de resplandores
// y degradados: `rgba(224,162,60,.35)` es el dorado, `rgba(0,206,201,.2)` el
// turquesa y `rgba(108,92,231,.3)` el morado del blog. El reemplazo por
// hexadecimal no los ve, y quedaban 166 páginas con un botón lima rodeado de
// un halo dorado. Se sustituye la TERNA, respetando la opacidad de cada uso.
const TERNAS = [
  [/224,\s*162,\s*60/g,  '196, 245, 70'],  // dorado
  [/0,\s*206,\s*201/g,   '196, 245, 70'],  // turquesa
  [/108,\s*92,\s*231/g,  '196, 245, 70'],  // morado
  [/162,\s*155,\s*254/g, '168, 220, 42'],  // morado claro
  [/254,\s*202,\s*87/g,  '232, 184, 75'],  // amarillo → ámbar
];

// ── La captura real que falta ─────────────────────────────────────────────
const BLOQUE_CAPTURA = `
<!-- Captura REAL del producto. Añadida por scripts/unificar-marca-landings.js:
     42 de 43 landings no tenían ni una sola imagen, y por eso ninguna
     demostraba que el producto existe. -->
<section class="nf-prueba">
  <div class="nf-prueba-in">
    <p class="nf-prueba-k">Esto no es un montaje</p>
    <h2 class="nf-prueba-h">Así queda cada llamada en tu panel.</h2>
    <p class="nf-prueba-p">Con su resultado, su duración, la transcripción entera y qué decidió el asistente en cada momento. Lo abres cuando quieras.</p>
    <figure class="nf-prueba-f">
      <img src="/guia-img/llamadas.jpg" width="1400" height="940" loading="lazy" decoding="async"
           alt="Panel de llamadas de NodeFlow: cada llamada con su duración, su resultado, la cita reservada y el contacto.">
    </figure>
  </div>
</section>
`;

const CSS_CAPTURA = `
/* Bloque de prueba real — unificar-marca-landings.js */
.nf-prueba{padding:clamp(56px,8vw,104px) 0;border-top:1px solid rgba(226,236,214,.11)}
.nf-prueba-in{max-width:1040px;margin:0 auto;padding:0 22px}
.nf-prueba-k{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#818B76;margin:0 0 14px}
.nf-prueba-h{font-family:'Clash Display',system-ui,sans-serif;font-size:clamp(1.6rem,3.4vw,2.5rem);line-height:1.1;letter-spacing:-.03em;color:#EEF3E4;margin:0 0 14px;text-wrap:balance}
.nf-prueba-p{font-size:1.02rem;line-height:1.6;color:#B9C2AC;margin:0 0 30px;max-width:60ch}
.nf-prueba-f{margin:0;border:1px solid rgba(226,236,214,.11);border-radius:12px;overflow:hidden;background:#191E14}
.nf-prueba-f img{width:100%;display:block;height:auto}
/* Un hijo de rejilla con min-width:auto se niega a encogerse y desborda en
   móvil. Es el fallo más repetido de estas páginas. */
.nf-prueba-in > *{min-width:0}
`;

function migrar(html, nombre) {
  const cambios = [];
  let s = html;

  // 1) Fuentes de Google → las de la marca
  const reGoogle = /<link[^>]+fonts\.googleapis\.com[^>]*>/g;
  const rePreconn = /<link[^>]+fonts\.gstatic\.com[^>]*>\s*/g;
  if (reGoogle.test(s)) {
    s = s.replace(rePreconn, '');
    let primera = true;
    s = s.replace(reGoogle, () => { const r = primera ? FUENTES_MARCA : ''; primera = false; return r; });
    cambios.push('fuentes');
  }
  const antesFam = s;
  s = s.replace(/'Fraunces',\s*Georgia,\s*serif/g, "'Clash Display',system-ui,sans-serif")
       .replace(/'Fraunces',\s*serif/g, "'Clash Display',system-ui,sans-serif")
       .replace(/'Inter',\s*-apple-system,\s*sans-serif/g, "'Satoshi',system-ui,sans-serif")
       .replace(/'Inter',\s*sans-serif/g, "'Satoshi',system-ui,sans-serif");
  if (s !== antesFam) cambios.push('familias');

  // 2) Paleta
  let tocados = 0;
  for (const [de, a] of COLORES) {
    // También sin almohadilla: aparecen sueltos en gradientes y atributos.
    const re = new RegExp(de.slice(1), 'gi');
    const n = (s.match(re) || []).length;
    if (n) { s = s.replace(re, a.slice(1)); tocados += n; }
  }
  for (const [re, a] of TERNAS) {
    const n = (s.match(re) || []).length;
    if (n) { s = s.replace(re, a); tocados += n; }
  }
  if (tocados) cambios.push(`paleta(${tocados})`);

  // 3) Fuera los orbes y el ruido: <div> vacíos con filter:blur(90px) fijados
  //    al viewport. Decoración sin significado que además compone en cada
  //    frame. Estaban en las landings Y en el blog.
  const antesOrbes = s;
  // `\s*` antes de la llave: la primera versión no llevaba y se dejó fuera el
  // CSS de 19 páginas que lo escribían con espacio (`.orb { … }`), dejando
  // reglas muertas apuntando a colores que ya no existen.
  s = s.replace(/\s*<div class="orb orb-\d"><\/div>/g, '')
       .replace(/\s*<div class="noise"><\/div>/g, '')
       .replace(/\.orb\s*\{[^}]*\}/g, '')
       .replace(/\.orb-\d\s*\{[^}]*\}/g, '')
       .replace(/\.noise\s*\{[^}]*\}/g, '');
  if (s !== antesOrbes) cambios.push('orbes');

  // 4) Texto BLANCO sobre el acento: con el dorado se leía, con el lima no.
  const antesBtn = s;
  s = s.replace(/background:var\(--accent\);color:#fff/g, 'background:var(--accent);color:#0F110C');
  if (s !== antesBtn) cambios.push('boton');

  // 3) La captura, sólo si la página no tiene NINGUNA imagen y hay dónde meterla
  if (!SIN_CAPTURA.has(nombre) && !/<img\s/i.test(s) && /<\/body>/i.test(s)) {
    const cierre = s.lastIndexOf('</style>');
    if (cierre !== -1) s = s.slice(0, cierre) + CSS_CAPTURA + s.slice(cierre);
    // Antes del pie si existe; si no, al final del cuerpo.
    const iFooter = s.search(/<footer[\s>]/i);
    if (iFooter !== -1) s = s.slice(0, iFooter) + BLOQUE_CAPTURA + s.slice(iFooter);
    else s = s.replace(/<\/body>/i, BLOQUE_CAPTURA + '</body>');
    cambios.push('captura');
  }

  return { s, cambios };
}

// ── Recorrido ─────────────────────────────────────────────────────────────
const dry  = process.argv.includes('--dry');
const iSolo = process.argv.indexOf('--solo');
const solo = iSolo !== -1 ? process.argv[iSolo + 1] : null;

function recorrer(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUIR.has(e.name)) continue;
      recorrer(ruta, acc);
    } else if (e.name.endsWith('.html')) {
      acc.push(ruta);
    }
  }
  return acc;
}

const ficheros = recorrer(PUBLIC, [])
  .filter(f => !solo || f.includes(path.sep + solo + path.sep));

let tocadas = 0;
for (const f of ficheros) {
  const rel = path.relative(PUBLIC, f).split(path.sep).join('/');
  const carpeta = rel.split('/')[0].replace(/\.html$/, '');
  const antes = fs.readFileSync(f, 'utf8');
  const { s, cambios } = migrar(antes, carpeta);
  if (!cambios.length) continue;
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
  console.log(`  ${dry ? '~' : '✓'}  ${rel.padEnd(46)} ${cambios.join(' · ')}`);
}
console.log(`
${dry ? 'ENSAYO — no se ha escrito nada. ' : ''}Paginas tocadas: ${tocadas} de ${ficheros.length}`);
