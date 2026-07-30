// ============================================================
// NodeFlow — "Llamada rota" no es una sola cosa (2026-07-29)
//
// La auditoría avisaba de "10 llamadas rotas de 54" (18%). Al mirarlas una a una:
//   · 8 eran PRUEBAS de madrugada con asistentes de broma, desde el móvil de
//     Unai y desde el propio número de NodeFlow.
//   · 2 eran personas reales que oyeron el saludo y colgaron a los 5-8 segundos.
// O sea: CERO fallos del sistema, y una alarma que iba a sonar cada mañana.
//
// El fallo de fondo: `_isBroken` juntaba dos cosas que piden acciones opuestas.
// "La IA no habló" lo arreglas tú. "El cliente colgó al oírla" lo arreglas con
// el saludo y la voz — y encima es una señal de producto valiosa que quedaba
// enterrada bajo una alarma técnica falsa.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { esTraficoInterno, clasificarLlamada, resumirSalud } = require('../src/monitoring/call-outcome');

const NUESTRO = '+34843700849';     // número del pool de NodeFlow
const PRUEBA  = '+34666351319';     // móvil de Unai
const CLIENTE = '+34639941265';

const conSaludo = (extra = {}) => ({
  caller_number: CLIENTE, status: 'ended', turn_count: 0, duration_ms: 6000,
  transcript: [{ role: 'assistant', content: 'Hola, ha llamado a…' }], ...extra,
});

describe('esTraficoInterno', () => {
  test('una saliente desde nuestro pool es tráfico nuestro', () => {
    assert.strictEqual(esTraficoInterno({ caller_number: NUESTRO }, { propios: [NUESTRO] }), true);
  });
  test('el móvil de pruebas también', () => {
    assert.strictEqual(esTraficoInterno({ caller_number: PRUEBA }, { prueba: [PRUEBA] }), true);
  });
  test('un cliente real NO', () => {
    assert.strictEqual(esTraficoInterno({ caller_number: CLIENTE }, { propios: [NUESTRO], prueba: [PRUEBA] }), false);
  });
  test('compara solo dígitos: los formatos varían', () => {
    assert.strictEqual(esTraficoInterno({ caller_number: '+34 666 35 13 19' }, { prueba: ['34666351319'] }), true);
  });
  test('sin número o sin listas, no se marca nada por si acaso', () => {
    assert.strictEqual(esTraficoInterno({}, { propios: [NUESTRO] }), false);
    assert.strictEqual(esTraficoInterno({ caller_number: CLIENTE }), false);
  });
});

describe('clasificarLlamada — separar lo nuestro de lo suyo', () => {
  test('EL CASO REAL: oyó el saludo y colgó → NO es un fallo del sistema', () => {
    const r = clasificarLlamada(conSaludo());
    assert.strictEqual(r.tipo, 'colgo_en_saludo');
    assert.match(r.motivo, /colgó/);
  });

  test('la IA no llegó a hablar → eso SÍ es nuestro', () => {
    const r = clasificarLlamada({ status: 'ended', turn_count: 0, duration_ms: 4000, transcript: [] });
    assert.strictEqual(r.tipo, 'sin_audio');
    assert.match(r.motivo, /audio o TTS/);
  });

  test('línea abierta larga sin un solo turno → avería (STT mudo)', () => {
    const r = clasificarLlamada(conSaludo({ duration_ms: 60000 }));
    assert.strictEqual(r.tipo, 'fallo_sistema');
    assert.match(r.motivo, /transcripción/);
  });

  test('murió a media conversación → fallo nuestro', () => {
    const r = clasificarLlamada({ status: 'lost', turn_count: 5, duration_ms: 40000 });
    assert.strictEqual(r.tipo, 'fallo_sistema');
    assert.match(r.motivo, /media conversación/);
  });

  test('una llamada normal es conversación', () => {
    assert.strictEqual(clasificarLlamada({ status: 'ended', turn_count: 7, duration_ms: 98000 }).tipo, 'conversacion');
  });

  test('entrada vacía no revienta', () => {
    assert.doesNotThrow(() => clasificarLlamada());
    assert.doesNotThrow(() => clasificarLlamada({}));
  });
});

describe('resumirSalud — reproduce el caso real que disparó esto', () => {
  const llamadas = [
    // 8 pruebas nuestras (madrugada, asistentes de broma)
    ...Array.from({ length: 6 }, (_, i) => conSaludo({ id: 'p' + i, caller_number: PRUEBA })),
    conSaludo({ id: 'p6', caller_number: NUESTRO }),
    conSaludo({ id: 'p7', caller_number: NUESTRO }),
    // 2 clientes reales que colgaron al oír la IA
    conSaludo({ id: 'c1' }), conSaludo({ id: 'c2', duration_ms: 8000 }),
    // y conversaciones de verdad
    ...Array.from({ length: 44 }, (_, i) => ({ id: 'ok' + i, caller_number: CLIENTE, status: 'ended', turn_count: 5, duration_ms: 90000 })),
  ];
  const nums = { propios: [NUESTRO], prueba: [PRUEBA] };

  test('excluye nuestro propio tráfico del juicio', () => {
    const r = resumirSalud(llamadas, nums);
    assert.strictEqual(r.internas, 8);
    assert.strictEqual(r.externas, 46);
  });

  test('la tasa de FALLO queda en cero: no había ninguna avería', () => {
    const r = resumirSalud(llamadas, nums);
    assert.strictEqual(r.tasaFallo, 0, 'la alarma del 18% era falsa');
    assert.strictEqual(r.fallos.length, 0);
  });

  test('y aparece la señal de producto que estaba enterrada', () => {
    const r = resumirSalud(llamadas, nums);
    assert.strictEqual(r.colgo_en_saludo, 2);
    assert.ok(r.tasaCuelgueSaludo > 0, 'cuánta gente cuelga al oír la IA es un dato que interesa');
  });

  test('una avería DE VERDAD sí se detecta', () => {
    const conAveria = [...llamadas, { id: 'x', caller_number: CLIENTE, status: 'ended', turn_count: 0, duration_ms: 5000, transcript: [] }];
    const r = resumirSalud(conAveria, nums);
    assert.strictEqual(r.sin_audio, 1);
    assert.ok(r.tasaFallo > 0);
    assert.strictEqual(r.fallos[0].id, 'x');
  });

  test('sin llamadas no revienta', () => {
    assert.strictEqual(resumirSalud([], nums).externas, 0);
    assert.strictEqual(resumirSalud(null, nums).total, 0);
  });
});
