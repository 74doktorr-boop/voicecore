#!/usr/bin/env node
'use strict';
// ============================================================
// NodeFlow — ¿Usamos algo que no hemos declarado?
//
// POR QUÉ EXISTE (2026-07-29):
// `src/api/data-export.js` hacía `require('jszip')` y jszip NO estaba en
// package.json. Funcionaba en el portátil por pura casualidad de dónde está la
// carpeta: el repo vive en `scratch/voicecore` y existe `scratch/node_modules`,
// así que Node subía por el árbol y lo encontraba FUERA del proyecto.
//
// Dentro del contenedor no hay ningún padre que valga: `npm ci --omit=dev`
// instala lo declarado y nada más. Resultado: la exportación completa de datos
// —la respuesta a "quiero poder llevarme todos mis datos sin pedirlo por
// soporte"— reventaba con MODULE_NOT_FOUND al primer clic, y llevaba así meses.
// La auditoría de promesas la había dado por VERIFICADA: el código era correcto,
// lo roto era el empaquetado.
//
// Un fallo así no se detecta leyendo código ni ejecutando tests en local. Se
// detecta comparando lo que se importa con lo que se declara. Eso es esto, y
// corre en CI para que bloquee el despliegue en vez de avisar a nadie.
//
//   node scripts/check-deps.js
// ============================================================

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const RAIZ = path.join(__dirname, '..');
const CARPETAS = ['src', 'scripts'];
const SUELTOS = ['server.js'];
const IGNORAR = new Set(['node_modules', '.git', '.claude', 'public', 'docs', 'db', 'test']);

const NATIVOS = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);

/**
 * OPCIONALES A PROPÓSITO: se importan pero NO deben estar en la imagen.
 *
 * Cada una exige un motivo escrito. No es burocracia: la diferencia entre una
 * dependencia opcional y una olvidada es exactamente que alguien lo decidió, y
 * si no está escrito no hay forma de distinguirlas dentro de seis meses — que
 * es como jszip acabó rompiendo producción.
 *
 * Requisito para estar aquí: el `require` va dentro de un try/catch que falla
 * RUIDOSAMENTE, con instrucciones. Si falla en silencio, no es opcional: es una
 * bomba.
 */
const OPCIONALES = {
  playwright: 'Corre en el worker de integraciones, no en el contenedor de voz. '
    + 'Son ~300 MB de navegadores. El require está en un try/catch que lanza con instrucciones '
    + '(src/integrations/drivers/playwright-driver.js).',
};

/**
 * Quita comentarios para no confundir un `require()` citado en una explicación
 * con uno real. Simplificado a propósito: no es un parser de JS, y equivocarse
 * de más aquí solo produce un falso positivo que se ve al instante.
 */
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')     // bloque
    .replace(/(^|[^:])\/\/.*$/gm, '$1');  // línea (evitando https://)
}

/**
 * Nombres de paquete importados en un fichero. PURO.
 * Solo especificadores literales: `require(variable)` no se puede resolver
 * estáticamente y se ignora a propósito (mejor callar que inventar).
 */
function paquetesImportados(src) {
  const limpio = sinComentarios(src);
  const fuera = new Set();
  const re = /(?:require\(\s*|(?:^|[\s;{])import\s+[^'"]*from\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(limpio))) {
    const spec = m[1];
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('\\')) continue;
    if (/^[a-zA-Z]:[\\/]/.test(spec)) continue;              // ruta absoluta de Windows
    // '@scope/pkg/sub' → '@scope/pkg' · 'pkg/sub' → 'pkg'
    const partes = spec.split('/');
    const nombre = spec.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0];
    if (NATIVOS.has(nombre) || NATIVOS.has(spec)) continue;
    fuera.add(nombre);
  }
  return [...fuera];
}

function ficheros(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, acc);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const declarados = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ]);

  const lista = [...CARPETAS.flatMap(c => ficheros(path.join(RAIZ, c))), ...SUELTOS.map(f => path.join(RAIZ, f))]
    .filter(f => fs.existsSync(f));

  const faltan = new Map();   // paquete → ficheros que lo usan
  const usados = new Set();

  for (const f of lista) {
    for (const p of paquetesImportados(fs.readFileSync(f, 'utf8'))) {
      usados.add(p);
      if (!declarados.has(p) && !OPCIONALES[p]) {
        if (!faltan.has(p)) faltan.set(p, []);
        faltan.get(p).push(path.relative(RAIZ, f));
      }
    }
  }

  console.log(`\n▶ Dependencias: ${lista.length} ficheros · ${usados.size} paquetes usados · ${declarados.size} declarados\n`);

  const opcionalesEnUso = Object.keys(OPCIONALES).filter(p => usados.has(p));
  if (opcionalesEnUso.length) {
    console.log('ℹ  Opcionales a propósito (fuera de la imagen, con motivo):');
    for (const p of opcionalesEnUso) console.log(`   ${p} — ${OPCIONALES[p]}`);
    console.log('');
  }

  if (faltan.size) {
    console.log('✖ SE USAN Y NO ESTÁN DECLARADAS EN package.json:\n');
    for (const [p, fs_] of faltan) {
      console.log(`   ${p}`);
      for (const f of fs_.slice(0, 5)) console.log(`      ${f}`);
      if (fs_.length > 5) console.log(`      …y ${fs_.length - 5} fichero(s) más`);
    }
    console.log('\n  En local puede funcionar (Node busca node_modules subiendo por el árbol).');
    console.log('  En el contenedor NO: `npm ci --omit=dev` instala solo lo declarado.');
    console.log(`\n  Arréglalo con:  npm install ${[...faltan.keys()].join(' ')}\n`);
    process.exit(1);
  }

  // Informativo, no bloquea: una dependencia declarada y sin usar es peso
  // muerto en la imagen, pero puede usarla un fichero fuera del barrido.
  const sinUsar = [...declarados].filter(d => !usados.has(d));
  if (sinUsar.length) console.log(`!  Declaradas y sin usar en src/ (revisar, no bloquea): ${sinUsar.join(', ')}\n`);

  console.log('✔ Todo lo que se importa está declarado.\n');
}

if (require.main === module) main();
module.exports = { paquetesImportados, sinComentarios };
