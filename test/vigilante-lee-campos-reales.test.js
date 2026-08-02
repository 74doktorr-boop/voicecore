'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL VIGILANTE LEE CAMPOS QUE EXISTEN
//
// Pasó el 02/08 y es la avería favorita de este repo: se cambia el que PRODUCE
// un dato y se olvida el que lo CONSUME. Al quitar los nombres de clientes del
// endpoint público, `/health/voz` dejó de tener `org` — y el vigilante siguió
// pidiendo `org`. Resultado: los correos de alarma decían
//
//     · None: sin voz configurada
//
// Nada falló. Ningún test se puso rojo. El endpoint devolvía 200, el vigilante
// terminaba en verde, y el aviso simplemente había dejado de decir de quién
// hablaba. Un aviso que no identifica el problema no llega a ser un aviso.
//
// Este fichero cruza las dos mitades: saca del YAML los campos que el vigilante
// pide con `.get('...')` y comprueba que el informe correspondiente los tiene.
// No es exhaustivo —solo cubre los bloques cuyo informe se puede construir
// aquí— pero cubre exactamente el camino que se rompió.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const YAML = fs.readFileSync(
  path.join(__dirname, '..', '.github/workflows/watchdog.yml'), 'utf8');

/** Trozo del YAML entre dos marcas, que es donde vive cada bloque de Python. */
function bloque(desde, hasta) {
  const i = YAML.indexOf(desde);
  assert.ok(i > 0, `no se encuentra el bloque «${desde}» en el vigilante`);
  const j = hasta ? YAML.indexOf(hasta, i) : YAML.length;
  return YAML.slice(i, j > 0 ? j : YAML.length);
}

/** Los campos que ese trozo pide por nombre. */
function camposQuePide(texto) {
  const campos = new Set();
  for (const m of texto.matchAll(/\.get\('([^']+)'/g)) campos.add(m[1]);
  return campos;
}

test('el bloque de VOZ solo pide campos que el informe público tiene', async () => {
  const mod = require('../src/monitoring/prueba-de-voz');
  const store = require('../src/utils/rate-store');
  await store.put(mod.CLAVE, JSON.stringify({
    cuando: '2026-08-02T10:00:00Z', revisadas: 2, conProblemas: 1,
    problemas: [{ org: 'X', orgId: 'o-1', voz: 'v', motivo: 'porque sí' }],
    avisos: [{ org: 'Y', orgId: 'o-2', aviso: 'ojo' }],
    detalle: [{ org: 'X', orgId: 'o-1', voz: 'v', ok: false, bytes: 0, ms: 1 }],
    resumen: 'algo',
  }), 60_000);
  const informe = await mod.informePublico();

  // Los campos de primer nivel y los de dentro de problemas/avisos.
  const disponibles = new Set([
    ...Object.keys(informe),
    ...Object.keys(informe.problemas[0] || {}),
    ...Object.keys(informe.avisos[0] || {}),
  ]);

  for (const campo of camposQuePide(bloque('echo "── Voz ──"', '── Versión desplegada ──'))) {
    assert.ok(disponibles.has(campo),
      `el vigilante pide «${campo}» a /health/voz y ese campo NO existe: el aviso saldría vacío`);
  }
});

test('el bloque de LLAMADAS solo pide campos que el endpoint publica', async () => {
  const mod = require('../src/lifecycle/conciliacion-telnyx');
  const inf = await mod.informe();
  // La ruta pública recorta el informe; se replica aquí la forma que sirve.
  const publicados = new Set(['perdidasRegistradas', 'ultimas24h', 'cuando', 'persistente', 'resumen']);
  for (const c of publicados) {
    assert.ok(c in inf || c === 'cuando',
      `la ruta publica «${c}» y el informe no lo trae`);
  }
  for (const campo of camposQuePide(bloque('echo "── Llamadas ──"', 'echo "── Voz ──"'))) {
    assert.ok(publicados.has(campo),
      `el vigilante pide «${campo}» a /health/llamadas y no se publica`);
  }
});

test('el bloque de AVISOS solo pide campos que el informe público tiene', async () => {
  const mod = require('../src/notifications/registro-avisos');
  const informe = await mod.informePublico();
  const disponibles = new Set(Object.keys(informe));
  for (const campo of camposQuePide(bloque('echo "── Canal de avisos ──"', 'echo "── Llamadas ──"'))) {
    assert.ok(disponibles.has(campo),
      `el vigilante pide «${campo}» a /health/avisos y ese campo NO existe`);
  }
});

test('el vigilante ya NO pide «org» a la voz — se retiró al dejar de publicar nombres', () => {
  const b = bloque('echo "── Voz ──"', '── Versión desplegada ──');
  assert.doesNotMatch(b, /\.get\('org'\)/,
    'vuelve a pedir «org», que el endpoint público no publica: los avisos dirán None');
  assert.match(b, /\.get\('ref'\)/, 'debería identificar al cliente por su referencia opaca');
});
