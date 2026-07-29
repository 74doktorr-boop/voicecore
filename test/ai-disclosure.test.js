// ============================================================
// NodeFlow — El aviso de que es una IA está garantizado (auditoría 2026-07-29)
//
// Afirmamos en tres sitios de la web que "la IA avisa SIEMPRE de que es IA".
// Pero el aviso vivía en assistant_config.firstMessage, un campo de texto libre
// que el cliente edita desde el portal SIN validación: podía borrarlo en diez
// segundos. Entonces NodeFlow quedaba afirmando algo que su producto no
// garantizaba, y el cliente incumplía el art. 50 del AI Act con una herramienta
// que le prometía justo lo contrario.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { hasAIDisclosure, ensureAIDisclosure, AVISO } = require('../src/assistants/ai-disclosure');

describe('hasAIDisclosure', () => {
  test('reconoce el saludo por defecto de NodeFlow', () => {
    assert.strictEqual(hasAIDisclosure('Buenos días, ha llamado a Clínica X. Soy su asistente virtual, ¿en qué puedo ayudarle?'), true);
  });

  test('reconoce variantes que el dueño puede escribir por su cuenta', () => {
    for (const t of [
      'Hola, soy un asistente automático de la peluquería.',
      'Le atiende un sistema automático.',
      'Soy una IA, dígame.',
      'Esto es inteligencia artificial, ¿en qué le ayudo?',
    ]) assert.strictEqual(hasAIDisclosure(t), true, t);
  });

  test('reconoce el aviso en galego y en euskera', () => {
    assert.strictEqual(hasAIDisclosure('Bo día, son o seu asistente virtual.'), true);
    assert.strictEqual(hasAIDisclosure('Egun on, zure laguntzaile birtuala naiz.'), true);
  });

  test('EL AGUJERO: un saludo sin aviso se detecta', () => {
    assert.strictEqual(hasAIDisclosure('Hola, ha llamado a Peluquería Amaia, ¿en qué puedo ayudarle?'), false);
    assert.strictEqual(hasAIDisclosure('Buenas, dígame.'), false);
  });

  test('vacío o basura → false, sin romper', () => {
    for (const t of ['', '   ', null, undefined, 42]) assert.strictEqual(hasAIDisclosure(t), false);
  });
});

describe('ensureAIDisclosure', () => {
  test('si el saludo ya avisa, NO se toca ni una coma', () => {
    const s = 'Buenos días, ha llamado a Clínica X. Soy su asistente virtual, ¿en qué puedo ayudarle?';
    assert.strictEqual(ensureAIDisclosure(s, 'es'), s);
  });

  test('si NO avisa, se añade el aviso y el saludo del dueño se conserva entero', () => {
    const s = 'Hola, ha llamado a Peluquería Amaia, ¿en qué puedo ayudarle?';
    const out = ensureAIDisclosure(s, 'es');
    assert.ok(out.startsWith(s), 'el negocio conserva su primera frase, que marca el tono');
    assert.strictEqual(hasAIDisclosure(out), true);
    assert.ok(out.includes(AVISO.es));
  });

  test('el aviso va en el idioma del asistente', () => {
    assert.ok(ensureAIDisclosure('Bo día, chamou a Casa Pepe.', 'gl').includes(AVISO.gl));
    assert.ok(ensureAIDisclosure('Egun on, Harategia da.', 'eu').includes(AVISO.eu));
  });

  test('los combos de idioma (es+gl, es+eu) resuelven por el idioma base', () => {
    assert.ok(ensureAIDisclosure('Hola, buenas.', 'es+gl').includes(AVISO.es));
    assert.ok(ensureAIDisclosure('Hola, buenas.', 'es+eu').includes(AVISO.es));
  });

  test('puntuación correcta tanto si el saludo termina en punto como si no', () => {
    assert.ok(!ensureAIDisclosure('Hola, buenas', 'es').includes('buenas.  '));
    assert.ok(ensureAIDisclosure('Hola, buenas', 'es').includes('buenas. '));
    assert.ok(ensureAIDisclosure('¿Dígame?', 'es').includes('¿Dígame? '));
  });

  test('saludo vacío = "sin opinión": no se inventa un saludo', () => {
    assert.strictEqual(ensureAIDisclosure('', 'es'), '');
    assert.strictEqual(ensureAIDisclosure('   ', 'es'), '');
    assert.strictEqual(ensureAIDisclosure(null, 'es'), '');
  });

  test('es idempotente: guardar dos veces no duplica el aviso', () => {
    const una = ensureAIDisclosure('Hola, ha llamado a Peluquería Amaia.', 'es');
    assert.strictEqual(ensureAIDisclosure(una, 'es'), una);
  });
});
