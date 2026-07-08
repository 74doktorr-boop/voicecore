// ============================================================
// NodeFlow — Brevedad, saludo natural, cierre con gracia y
// criterio de relevancia (funciones PURAS)
// ------------------------------------------------------------
// Veredicto del fundador (75/100): "la IA habla demasiado y no le
// deja respirar al cliente." Estos tests fijan las transformaciones
// deterministas que sostienen los arreglos: el saludo por nombre no
// pierde la identidad del negocio, el token [NO_DIRIGIDO] JAMÁS se
// pronuncia, y un "nada" corto se reconoce como cierre (no como ruido).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  NOT_ADDRESSED_TOKEN,
  brevityPromptBlock,
  extractBusinessName,
  personalizeGreeting,
  isShortCloser,
  containsNotAddressedToken,
  stripNotAddressedToken,
} = require('../src/assistants/greeting');

describe('brevityPromptBlock — reglas de brevedad y relevancia', () => {
  test('impone respuestas cortas: una idea/una pregunta por turno', () => {
    const b = brevityPromptBlock(true);
    assert.match(b, /BREVEDAD/);
    assert.match(b, /UNA sola idea y UNA sola pregunta/i);
    assert.match(b, /PROHIBIDO enumerar/i);
  });

  test('define el token de relevancia y prohíbe apilar preguntas', () => {
    const b = brevityPromptBlock(true);
    assert.ok(b.includes(NOT_ADDRESSED_TOKEN));
    assert.match(b, /NUNCA apiles preguntas/i);
  });

  test('con saludo previo, prohíbe re-saludar a media llamada', () => {
    assert.match(brevityPromptBlock(true), /NO vuelvas a saludar/i);
  });

  test('sin saludo previo, no incluye la prohibición de re-saludo', () => {
    assert.doesNotMatch(brevityPromptBlock(false), /NO vuelvas a saludar/i);
  });

  test('incluye el bloque de cierre con gracia', () => {
    assert.match(brevityPromptBlock(true), /CIERRE CON GRACIA/i);
  });
});

describe('extractBusinessName — identidad del negocio del firstMessage', () => {
  test('extrae de "ha llamado a X."', () => {
    assert.strictEqual(
      extractBusinessName('Buenos días, ha llamado a Clínica Etxeberria. Soy su asistente, ¿en qué puedo ayudarle?'),
      'Clínica Etxeberria'
    );
  });
  test('extrae con coma en vez de punto', () => {
    assert.strictEqual(
      extractBusinessName('Hola, ha llamado a Taller Unai, dígame'),
      'Taller Unai'
    );
  });
  test('extrae del gallego "chamou a X."', () => {
    assert.strictEqual(
      extractBusinessName('Bos días, chamou a Peluquería Ana. Son o seu asistente.'),
      'Peluquería Ana'
    );
  });
  test('sin patrón reconocible → null', () => {
    assert.strictEqual(extractBusinessName('Dígame'), null);
    assert.strictEqual(extractBusinessName(''), null);
    assert.strictEqual(extractBusinessName(null), null);
  });
});

describe('personalizeGreeting — saludo natural que reconoce ANTES de hablar', () => {
  const first = 'Buenos días, ha llamado a Clínica Etxeberria. Soy su asistente virtual, ¿en qué puedo ayudarle?';

  test('con nombre conocido: abre por su nombre manteniendo el negocio', () => {
    const g = personalizeGreeting(first, 'Raúl');
    assert.strictEqual(g, '¡Hola Raúl! Soy la asistente de Clínica Etxeberria, ¿en qué te ayudo?');
  });

  test('usa solo el primer nombre (más natural al teléfono)', () => {
    const g = personalizeGreeting(first, 'Raúl García Pérez');
    assert.match(g, /^¡Hola Raúl!/);
    assert.doesNotMatch(g, /García/);
  });

  test('sin nombre → devuelve el saludo configurado tal cual (genérico)', () => {
    assert.strictEqual(personalizeGreeting(first, ''), first);
    assert.strictEqual(personalizeGreeting(first, null), first);
    assert.strictEqual(personalizeGreeting(first, '   '), first);
  });

  test('sin poder extraer el negocio, cae al businessName pasado', () => {
    const g = personalizeGreeting('Dígame', 'Ana', 'Barbería Sol');
    assert.strictEqual(g, '¡Hola Ana! Soy la asistente de Barbería Sol, ¿en qué te ayudo?');
  });

  test('sin negocio de ningún tipo, saludo genérico personal', () => {
    assert.strictEqual(personalizeGreeting('Dígame', 'Ana'), '¡Hola Ana! Soy tu asistente, ¿en qué te ayudo?');
  });

  test('preserva el token {{GREETING}} si el negocio no se pudo extraer', () => {
    // El pipeline resuelve {{GREETING}} después; personalizeGreeting no lo toca.
    const g = personalizeGreeting('{{GREETING}}, dígame', '', 'X');
    assert.ok(g.includes('{{GREETING}}'));
  });
});

describe('isShortCloser — cierre corto ≠ fallo de STT', () => {
  for (const s of ['nada', 'Nada.', 'no', 'No, nada', 'no gracias', 'ya está', 'eso es todo',
                   'nada más', 'está bien', 'así está bien', 'ninguno', 'no hace falta',
                   'listo', 'vale gracias', 'todo bien']) {
    test(`reconoce cierre: "${s}"`, () => {
      assert.strictEqual(isShortCloser(s), true);
    });
  }

  for (const s of ['quiero pedir una cita', 'no puedo el martes pero sí el jueves',
                   '¿qué precio tiene el corte de pelo?', 'nada de lo que me has dicho me sirve, prefiero otro día',
                   '']) {
    test(`NO confunde con petición real: "${s}"`, () => {
      assert.strictEqual(isShortCloser(s), false);
    });
  }

  test('una frase larga aunque empiece por "no" no es cierre', () => {
    assert.strictEqual(isShortCloser('no, mejor a las cinco de la tarde si puede ser'), false);
  });
});

describe('[NO_DIRIGIDO] — el token NUNCA se pronuncia', () => {
  test('detecta el token aislado', () => {
    assert.strictEqual(containsNotAddressedToken(NOT_ADDRESSED_TOKEN), true);
  });
  test('detecta el token incrustado', () => {
    assert.strictEqual(containsNotAddressedToken(`Vale ${NOT_ADDRESSED_TOKEN} claro`), true);
  });
  test('texto normal no lo contiene', () => {
    assert.strictEqual(containsNotAddressedToken('¿En qué puedo ayudarle?'), false);
  });

  test('strip: el token aislado se convierte en vacío (nada que decir)', () => {
    assert.strictEqual(stripNotAddressedToken(NOT_ADDRESSED_TOKEN), '');
  });
  test('strip: token incrustado se elimina sin dejar dobles espacios', () => {
    const out = stripNotAddressedToken(`Perfecto ${NOT_ADDRESSED_TOKEN} le atiendo`);
    assert.ok(!out.includes(NOT_ADDRESSED_TOKEN));
    assert.doesNotMatch(out, /\s{2,}/);
  });
  test('strip de texto sin token lo deja intacto', () => {
    assert.strictEqual(stripNotAddressedToken('Hola, dígame'), 'Hola, dígame');
  });
});
