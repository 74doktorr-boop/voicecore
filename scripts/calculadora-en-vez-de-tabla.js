#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   LA CALCULADORA QUE SUSTITUYE A LAS 27 TABLAS INVENTADAS
   ───────────────────────────────────────────────────────────────────────────
   Las 26 páginas de sector enseñaban un bloque con pinta de tabla de
   resultados: «Impacto mensual · despacho de abogados típico — Consultas
   captadas +88%, Tiempo en recepción −78%, Clientes perdidos −85%», rematado
   con «Estimaciones basadas en despachos con 1-5 profesionales en Bizkaia y
   Gipuzkoa».

   No hay tales despachos. Es la misma mentira que el estudio inventado, pero
   **con formato de datos**, que es justo lo que la hace más creíble y por
   tanto más dañina. Un porcentaje dentro de una barra de progreso parece
   medido aunque no lo esté.

   POR QUÉ UNA CALCULADORA Y NO BORRARLAS. Borrar deja 26 páginas sin su bloque
   de prueba y no gana nada. La calculadora cambia quién hace la afirmación:
   deja de ser «los despachos ganan un 88%» y pasa a ser «con TUS llamadas y TU
   ticket, esto es lo que se te está escapando». Es más persuasivo justamente
   porque no es nuestro — y es lo único que el visitante no puede desmentir,
   porque los números los ha puesto él.

   LAS TRES REGLAS QUE LA HACEN HONESTA:

   1. NINGÚN NÚMERO NUESTRO EN EL RESULTADO. Todo sale de lo que teclea el
      visitante. Lo único precargado es un punto de partida editable, y se dice
      que lo es.

   2. EL ÚNICO DATO EXTERNO VA CITADO Y ES AJUSTABLE. El «cuántas se quedan sin
      coger» arranca en el 27% de Invoca (más de 60 millones de llamadas
      analizadas en 2024) — con la fuente escrita al lado y un control para
      cambiarlo. Si al visitante le parece mucho, lo baja y la cuenta se
      rehace. Un dato que se puede bajar no es una trampa.

   3. LA CUENTA SE ENSEÑA ENTERA. Debajo del resultado va la fórmula con los
      números metidos. Si alguien quiere discutirla, tiene con qué. Una
      calculadora que esconde su aritmética es otra caja negra, y vendemos lo
      contrario.

   Uso:  node scripts/calculadora-en-vez-de-tabla.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const dry = process.argv.includes('--dry');

const CSS = `
    /* Calculadora — sustituye a la tabla de impacto inventada */
    .calc { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:28px; }
    .calc h4 { font-size:17px; font-weight:700; margin-bottom:6px; color:var(--text); }
    .calc-sub { font-size:13px; color:var(--muted); line-height:1.6; margin-bottom:22px; }
    .calc-f { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
    .calc-f label { font-size:13.5px; color:var(--text); flex:1; min-width:150px; }
    .calc-f input[type=number] { width:92px; background:var(--bg); border:1px solid var(--border);
      color:var(--text); border-radius:8px; padding:9px 11px; font:inherit; font-size:14px;
      text-align:right; font-variant-numeric:tabular-nums; min-height:44px; }
    /* 44 px es el mínimo para acertar con el pulgar. Sin el min-height se
       quedaban en 42 y en un móvil eso se falla, y quien falla no reintenta. */
    .calc-f input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    .calc-f .u { font-size:12.5px; color:var(--muted); min-width:56px; }
    .calc-note { font-size:11.5px; color:var(--muted); line-height:1.55; margin:-8px 0 18px; }
    .calc-note a { color:var(--accent); }
    .calc-out { border-top:1px solid var(--border); margin-top:22px; padding-top:22px; }
    .calc-big { font-size:clamp(26px,4.6vw,38px); font-weight:800; color:var(--accent);
      line-height:1.1; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
    .calc-big small { display:block; font-size:13px; font-weight:500; color:var(--text);
      letter-spacing:0; margin-top:6px; }
    .calc-cuenta { font-size:12px; color:var(--muted); line-height:1.7; margin-top:16px;
      font-variant-numeric:tabular-nums; }
    .calc-cuenta b { color:var(--text); font-weight:600; }
    @media (prefers-reduced-motion:no-preference){ .calc-big { transition:color .2s; } }
`;

// El bloque. Sin dependencias, sin peticiones, y funciona sin JS: los valores
// por defecto ya están escritos en el HTML, así que quien no ejecute scripts
// ve una cuenta completa y coherente en vez de una tarjeta vacía.
const BLOQUE = `<div class="calc">
            <h4>Échale la cuenta con tus números</h4>
            <p class="calc-sub">No tenemos clientes de los que sacar porcentajes, así que no te los vamos a enseñar. Pon lo tuyo y sale tu cifra.</p>

            <div class="calc-f">
              <label for="c-lla">Llamadas que recibes al día</label>
              <input type="number" id="c-lla" value="20" min="0" max="500" step="1">
              <span class="u">al día</span>
            </div>
            <div class="calc-f">
              <label for="c-per">De cada 100, cuántas se quedan sin coger</label>
              <input type="number" id="c-per" value="27" min="0" max="100" step="1">
              <span class="u">de 100</span>
            </div>
            <p class="calc-note">El 27 de partida no es nuestro: es lo que midió Invoca en 2024 analizando más de 60 millones de llamadas a negocios de servicios. Si crees que en tu caso es menos, bájalo — la cuenta se rehace sola.</p>
            <div class="calc-f">
              <label for="c-con">De las que se pierden, cuántas habrían acabado en cliente</label>
              <input type="number" id="c-con" value="30" min="0" max="100" step="1">
              <span class="u">de 100</span>
            </div>
            <div class="calc-f">
              <label for="c-val">Lo que te deja de media un cliente</label>
              <input type="number" id="c-val" value="60" min="0" max="100000" step="5">
              <span class="u">euros</span>
            </div>

            <div class="calc-out">
              <p class="calc-big" id="c-res" aria-live="polite">2.160 €<small>al mes que hoy se quedan en el teléfono sin coger</small></p>
              <p class="calc-cuenta" id="c-cuenta">
                20 llamadas/día × 22 días laborables = <b>440 al mes</b>.<br>
                El 27% sin coger = <b>119</b>. De ésas, 30 de cada 100 habrían sido cliente = <b>36</b>.<br>
                36 × 60 € = <b>2.160 € al mes</b>. NodeFlow cuesta 49 €.
              </p>
            </div>
          </div>`;

const SCRIPT = `<script>
/* La calculadora que sustituyó a la tabla de impacto inventada.
   Todo el resultado sale de lo que teclea el visitante: aquí no hay ni un
   número nuestro. Y la cuenta se imprime entera debajo — una calculadora que
   esconde su aritmética es otra caja negra, y vendemos justo lo contrario. */
(function(){
  var e=function(i){return document.getElementById(i)};
  var lla=e('c-lla'), per=e('c-per'), con=e('c-con'), val=e('c-val'),
      res=e('c-res'), cue=e('c-cuenta');
  if(!lla||!res) return;
  /* Separador de miles a mano, no toLocaleString: al probarlo, 9600 salió
     «9600» en vez de «9.600» porque el entorno no traía los datos de locale
     completos. Una cifra de dinero sin puntos se lee mal y encima delata que
     no se ha probado. Esto no depende de nada. */
  var eur=function(n){
    n=Math.round(n);
    var s=String(n), out='', c=0;
    for(var i=s.length-1;i>=0;i--){ out=s[i]+out; if(++c%3===0&&i>0) out='.'+out; }
    return out;
  };
  function calc(){
    var L=Math.max(0,+lla.value||0), P=Math.min(100,Math.max(0,+per.value||0)),
        C=Math.min(100,Math.max(0,+con.value||0)), V=Math.max(0,+val.value||0);
    var mes=L*22, perdidas=Math.round(mes*P/100), clientes=Math.round(perdidas*C/100),
        euros=clientes*V;
    res.innerHTML=eur(euros)+' €<small>al mes que hoy se quedan en el teléfono sin coger</small>';
    cue.innerHTML=eur(L)+' llamadas/día × 22 días laborables = <b>'+eur(mes)+' al mes</b>.<br>'+
      'El '+P+'% sin coger = <b>'+eur(perdidas)+'</b>. De ésas, '+C+' de cada 100 habrían sido cliente = <b>'+eur(clientes)+'</b>.<br>'+
      eur(clientes)+' × '+eur(V)+' € = <b>'+eur(euros)+' € al mes</b>. NodeFlow cuesta 49 €.';
  }
  [lla,per,con,val].forEach(function(i){ i.addEventListener('input',calc); });
  /* Y se recalcula al cargar. Si no, lo que ve el visitante hasta que toca algo
     es lo que yo dejé escrito a mano en el HTML — y la primera vez lo dejé mal:
     puse 2.376 € donde salían 2.160. Que la única cifra de la página la calcule
     la máquina y no yo es justo el punto de todo esto. */
  calc();
})();
</script>`;

// ── Recorrido ─────────────────────────────────────────────────────────────
function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'hementxe') paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');

// El bloque va desde <div class="roi-chart"> hasta el </div> que cierra, justo
// tras el párrafo de «Estimaciones basadas en…». Se acota por ese párrafo para
// no comerse lo que viene después.
// La coletilla de procedencia está escrita de TRES formas distintas según la
// página —«Estimaciones basadas en», «Datos estimados para», «Estimación
// para»—. Con una sola encajaban 15 de 27 y el informe decía «12 no encajan»
// en vez de «hay tres plantillas». Se acotan las tres.
// Cinco redacciones distintas, no una. Y la quinta —«Sin datos de clientes
// todavía»— la escribí yo hace un rato al arreglar otra cosa: si acoto por la
// frase, mi propio arreglo previo esconde la tabla del siguiente barrido. Por
// eso el corte no se ancla en el TEXTO sino en la ESTRUCTURA: el bloque va del
// <div class="roi-chart"> a su párrafo de pie y el </div> que lo cierra.
const PROCEDENCIA = /(Estimaciones basadas en|Datos estimados para|Estimación para|Datos basados en|Sin datos de clientes todavía)/;
const RE_TABLA = /<div class="roi-chart">[\s\S]*?<p style="font-size:12px[^"]*"[^>]*>[^<]*<\/p>\s*<\/div>/;

let tocadas = 0, sinTabla = [];
for (const f of paginas()) {
  const antes = fs.readFileSync(f, 'utf8');
  if (!antes.includes('roi-chart')) continue;
  if (!RE_TABLA.test(antes)) { sinTabla.push(rel(f)); continue; }

  let s = antes.replace(RE_TABLA, BLOQUE);
  // El CSS entra antes del cierre del <style> de la página, para heredar sus
  // variables (--card, --border, --accent) en vez de duplicar la paleta.
  s = s.replace(/<\/style>/, CSS + '\n  </style>');
  s = s.replace(/<\/body>/, SCRIPT + '\n</body>');
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
}

// ── Comprobaciones ────────────────────────────────────────────────────────
const quedan = paginas().filter(f => fs.readFileSync(f, 'utf8').match(PROCEDENCIA)).map(rel);
console.log(`${dry ? 'ENSAYO — no se ha escrito nada.\n' : ''}Tablas sustituidas por calculadora: ${tocadas}`);
if (sinTabla.length) {
  console.log(`\nTienen roi-chart pero no encajan con el patrón (${sinTabla.length}):`);
  sinTabla.slice(0, 8).forEach(x => console.log('   · ' + x));
}
if (!dry && quedan.length) {
  console.log(`\n⚠ Siguen con la procedencia inventada (${quedan.length}):`);
  quedan.slice(0, 8).forEach(x => console.log('   · ' + x));
  process.exitCode = 1;
}
