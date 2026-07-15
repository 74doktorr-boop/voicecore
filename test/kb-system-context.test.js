// ============================================================
// NodeFlow — La KB inyectada en el prompt de voz es REFERENCIA, no dogma.
// Auditoría 2026-07-16: getSystemContext volcaba la KB con tono autoritativo
// ("usa esta información para responder con precisión") → texto de ejemplo o
// plantilla sin rellenar guardado en la KB se afirmaba como dato real (raíz
// del incidente "aparcamiento/seguros inventados"). Ahora se encuadra como
// referencia falible subordinada a las REGLAS INQUEBRANTABLES.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { KnowledgeBase } = require('../src/knowledge/base');

function kbWith(chunks) {
  const kb = new KnowledgeBase({ openaiApiKey: 'x' });
  kb._load = async () => chunks.map(c => ({ content: c, source: 'manual' })); // aislar de la BD
  return kb;
}

describe('KB getSystemContext — encuadre de seguridad', () => {
  test('el bloque marca la info como REFERENCIA falible y remite a las reglas', async () => {
    const kb = kbWith(['Horario: L-V 9:00-14:00.']);
    const out = await kb.getSystemContext('org-1');
    assert.ok(out.includes('Horario: L-V 9:00-14:00.'), 'incluye el contenido real');
    assert.ok(/referencia/i.test(out), 'lo marca como referencia');
    assert.ok(out.includes('no me consta, el equipo te lo confirma'), 'da la salida segura ante lo no cubierto');
    assert.ok(/ejemplo o una plantilla/i.test(out), 'avisa de ignorar texto de ejemplo/plantilla');
  });

  test('YA NO usa el tono autoritativo que causó el incidente', async () => {
    const kb = kbWith(['Aceptamos DKV y hay parking gratis (ejemplo).']);
    const out = await kb.getSystemContext('org-1');
    assert.ok(!/responder con precisi[oó]n/i.test(out), 'sin "responder con precisión"');
    assert.ok(/REGLAS INQUEBRANTABLES/.test(out), 'se declara subordinada a las reglas');
  });

  test('KB vacía → cadena vacía (fail-safe, no rompe la llamada)', async () => {
    const kb = kbWith([]);
    assert.strictEqual(await kb.getSystemContext('org-1'), '');
  });
});
