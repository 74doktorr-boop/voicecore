'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LOS WORKFLOWS TIENEN QUE SER YAML VÁLIDO, Y NADIE LO COMPROBABA
//
// Un fichero de `.github/workflows/` roto no da error en ninguna parte: GitHub
// simplemente **sigue ejecutando la última versión que sí pudo leer**, y todo
// parece normal. Los despliegues verdes, el vigilante en verde, y mientras
// tanto lo que corre es código de hace tres commits.
//
// Pasó el 01/08 con `watchdog.yml`: metí dentro un heredoc de Python con el
// cuerpo en la columna 0. En YAML, una línea con menos sangría que el escalar
// `run: |` lo CIERRA, así que el fichero dejó de ser válido. El script se
// ejecutaba perfecto en local —`bash -n` verde, funcionaba contra producción—
// porque mi extractor casero quitaba diez espacios «si los había» y dejaba
// pasar el resto. Era más tolerante que YAML, o sea que no verificaba nada:
// tranquilizaba.
//
// Sólo se destapó de casualidad, porque `gh workflow run` contestó «no tiene
// disparador workflow_dispatch» — el disparador estaba escrito, en un fichero
// que nadie podía leer. Sin ese intento, el vigilante mejorado habría estado
// semanas sin correr y yo convencido de que sí.
//
// Esto lo cierra: se parsea con el mismo formato que usa Actions, en cada
// `npm test`, sin que nadie tenga que acordarse.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '.github', 'workflows');
const ficheros = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

let yaml = null;
try { yaml = require('js-yaml'); } catch (_) { /* se comprueba abajo */ }

test('js-yaml está disponible para poder validar (si no, esto no comprueba nada)', () => {
  // Sin esta comprobación, perder js-yaml convertiría todos los tests de abajo
  // en no-ops verdes: el peor resultado posible, porque parece vigilancia.
  assert.ok(yaml, 'falta js-yaml — los tests de workflows no estarían comprobando nada');
});

test('hay workflows que comprobar', () => {
  assert.ok(ficheros.length > 0, 'no se encontró ningún workflow en .github/workflows');
});

for (const f of ficheros) {
  test(`${f} es YAML válido y GitHub puede leerlo`, () => {
    if (!yaml) return;
    const texto = fs.readFileSync(path.join(DIR, f), 'utf8');
    let doc;
    try {
      doc = yaml.load(texto);
    } catch (e) {
      assert.fail(
        `${f} NO es YAML válido, así que GitHub está ejecutando una versión ANTERIOR ` +
        `sin avisar de nada:\n  ${e.message}`);
    }
    assert.ok(doc && typeof doc === 'object', `${f}: el YAML no define nada`);

    // `on:` en YAML 1.1 se lee como el booleano true. Es la trampa clásica y por
    // eso se aceptan las dos formas.
    const disparadores = doc.on || doc.true;
    assert.ok(disparadores && Object.keys(disparadores).length,
      `${f}: no declara ningún disparador (\`on:\`) — no se ejecutaría nunca`);

    assert.ok(doc.jobs && Object.keys(doc.jobs).length, `${f}: no tiene jobs`);
    for (const [nombre, job] of Object.entries(doc.jobs)) {
      assert.ok(Array.isArray(job.steps) && job.steps.length,
        `${f}: el job "${nombre}" no tiene pasos`);
    }
  });
}

test('el vigilante conserva su disparador manual', () => {
  if (!yaml) return;
  // Poder lanzarlo a mano es lo que permite probarlo sin esperar al cron — y fue
  // justamente el `gh workflow run` fallido lo que destapó el YAML roto.
  const doc = yaml.load(fs.readFileSync(path.join(DIR, 'watchdog.yml'), 'utf8'));
  const on = doc.on || doc.true;
  assert.ok('workflow_dispatch' in on, 'watchdog.yml ya no se puede lanzar a mano');
  assert.ok('schedule' in on, 'watchdog.yml ya no tiene cron');
});
