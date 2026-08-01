#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   SACA EL BLOQUE `run:` DE UN WORKFLOW PARA PODER EJECUTARLO EN LOCAL
   ───────────────────────────────────────────────────────────────────────────
   Existe por un fallo mío que conviene no repetir.

   Para probar el vigilante sin esperar al cron, extraía el `run: |` del YAML
   con un apaño de tres líneas que quitaba diez espacios «si los había». Metí
   dentro un heredoc de Python con el cuerpo en la columna 0 y mi extractor lo
   dejó pasar tan contento: el script salía bien, `bash -n` decía que sí, se
   ejecutaba correcto contra producción y lo di por bueno.

   Pero YAML NO es tan permisivo. Una línea con menos sangría que el escalar
   CIERRA el escalar, así que para GitHub aquel fichero estaba roto — y siguió
   ejecutando en silencio la versión ANTERIOR del vigilante. Lo delató que
   `gh workflow run` contestara «no tiene disparador workflow_dispatch»: el
   disparador estaba escrito, pero en un YAML que nadie podía leer.

   O sea, la herramienta con la que verificaba era MÁS TOLERANTE que la que iba
   a ejecutar de verdad, y por eso me dijo que todo bien. Un verificador más
   laxo que la realidad no verifica: tranquiliza.

   Este parte el YAML con un analizador de verdad (js-yaml, el mismo formato que
   usa Actions) y falla si el fichero no es válido.

   Uso:  node scripts/extraer-run-de-workflow.js .github/workflows/watchdog.yml [salida.sh]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const yaml = require('js-yaml');

const [, , ficheroYml, salida] = process.argv;
if (!ficheroYml) {
  console.error('uso: extraer-run-de-workflow.js <workflow.yml> [salida.sh]');
  process.exit(2);
}

let doc;
try {
  doc = yaml.load(fs.readFileSync(ficheroYml, 'utf8'));
} catch (e) {
  console.error(`✖ El YAML no es válido, así que GitHub NO lo está ejecutando:\n  ${e.message}`);
  process.exit(1);
}

// `on:` en YAML 1.1 se interpreta como el booleano true. Es la trampa clásica.
const disparadores = Object.keys(doc.on || doc.true || {});
const jobs = doc.jobs || {};
const pasos = [];
for (const [nombreJob, job] of Object.entries(jobs)) {
  for (const paso of job.steps || []) {
    if (typeof paso.run === 'string') pasos.push({ job: nombreJob, nombre: paso.name || '(sin nombre)', run: paso.run });
  }
}

if (!pasos.length) {
  console.error('✖ No hay ningún paso con `run:` en este workflow.');
  process.exit(1);
}

const script = pasos.map(p => p.run).join('\n');
if (salida) {
  fs.writeFileSync(salida, script, 'utf8');
  console.log(`✔ YAML válido · disparadores: ${disparadores.join(', ')} · ${pasos.length} paso(s) → ${salida}`);
} else {
  process.stdout.write(script);
}
