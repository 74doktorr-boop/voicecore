// ============================================================
// NodeFlow — El resumen de llamada cuenta algo (2026-07-29)
//
// El email al dueño decía "ℹ️ CONSULTA", el número y la duración. Y ya. Para una
// llamada de información —la mayoría— eso no informa de NADA: el dueño sabe que
// sonó el teléfono, que es justo lo que ya sabía.
//
// Y los datos estaban todos ahí: el post-call recibe el transcript completo y
// las aiDecisions (la caja negra construida precisamente para enseñar qué hizo
// la IA). El email no los pintaba. Mismo patrón que el ROI: la información
// existe, se calcula, y se descarta antes de enseñarla.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { firstAsk, decisionLines, conversationLines, subjectLine } = require('../src/notifications/call-summary');

const TRANSCRIPT = [
  { role: 'assistant', content: 'Hola, ha llamado a Hierros a Freixa. Soy su asistente virtual.' },
  { role: 'user',      content: 'Sí' },
  { role: 'assistant', content: '¿En qué puedo ayudarle?' },
  { role: 'user',      content: 'Quería saber si hacéis barandillas a medida para una escalera exterior' },
  { role: 'assistant', content: 'Sí, trabajamos hierro y acero inoxidable.' },
  { role: 'user',      content: 'Vale, ¿y cuánto puede costar más o menos?' },
];

describe('firstAsk — qué pedían', () => {
  test('se salta el "Sí" y encuentra lo que de verdad pedía', () => {
    assert.match(firstAsk(TRANSCRIPT), /barandillas a medida/);
  });

  test('ignora al asistente: lo que importa es lo que dijo el CLIENTE', () => {
    assert.ok(!firstAsk(TRANSCRIPT).includes('asistente virtual'));
  });

  test('si todo es corto, devuelve lo más largo antes que nada', () => {
    const t = [{ role: 'user', content: 'Sí' }, { role: 'user', content: 'Hola??' }];
    assert.strictEqual(firstAsk(t), 'Hola??');
  });

  test('cliente que no llegó a decir nada → cadena vacía, sin inventar', () => {
    assert.strictEqual(firstAsk([{ role: 'assistant', content: 'Hola' }]), '');
    assert.strictEqual(firstAsk([]), '');
    assert.strictEqual(firstAsk(null), '');
  });

  test('normaliza saltos y espacios (el STT los mete)', () => {
    const t = [{ role: 'user', content: '  Quiero   pedir\n\ncita para el martes  ' }];
    assert.strictEqual(firstAsk(t), 'Quiero pedir cita para el martes');
  });
});

describe('decisionLines — lo que hizo el asistente', () => {
  test('conserva el texto ya redactado en lenguaje de dueño', () => {
    const d = decisionLines([
      { tool: 'book_appointment', ok: true, summary: 'Reservó cita: Ana, 2026-07-30 10:00' },
      { tool: 'flag_urgent', ok: false, summary: '⚠️ Marcó la llamada como URGENTE' },
    ]);
    assert.deepStrictEqual(d, [
      { ok: true,  texto: 'Reservó cita: Ana, 2026-07-30 10:00' },
      { ok: false, texto: '⚠️ Marcó la llamada como URGENTE' },
    ]);
  });

  test('sin decisiones → lista vacía (el email no pinta la sección)', () => {
    assert.deepStrictEqual(decisionLines([]), []);
    assert.deepStrictEqual(decisionLines(undefined), []);
  });

  test('cae al nombre de la herramienta si no hay resumen', () => {
    assert.strictEqual(decisionLines([{ tool: 'check_availability' }])[0].texto, 'check_availability');
  });

  test('tope: una llamada larga no convierte el email en un tocho', () => {
    const muchas = Array.from({ length: 40 }, (_, i) => ({ tool: 't' + i, summary: 's' + i }));
    assert.strictEqual(decisionLines(muchas).length, 12);
  });
});

describe('conversationLines', () => {
  test('etiqueta quién habla y descarta lo vacío', () => {
    const { lineas } = conversationLines(TRANSCRIPT);
    assert.strictEqual(lineas.length, 6);
    assert.strictEqual(lineas[0].quien, 'asistente');
    assert.strictEqual(lineas[1].quien, 'cliente');
  });

  test('al recortar conserva el FINAL, que es lo que el dueño necesita', () => {
    // El final lleva lo que se acordó, el teléfono que dejó o la pega que puso.
    // El principio suele ser el saludo.
    const larga = Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: 'linea ' + i }));
    const { lineas, recortadas } = conversationLines(larga, 20);
    assert.strictEqual(lineas.length, 20);
    assert.strictEqual(recortadas, 30);
    assert.strictEqual(lineas[19].texto, 'linea 49');
  });

  test('una intervención larguísima se corta con puntos suspensivos', () => {
    const { lineas } = conversationLines([{ role: 'user', content: 'x'.repeat(900) }], 20, 400);
    assert.strictEqual(lineas[0].texto.length, 401);
    assert.ok(lineas[0].texto.endsWith('…'));
  });

  test('transcript vacío o basura → sin líneas, sin romper', () => {
    assert.deepStrictEqual(conversationLines(null).lineas, []);
    assert.deepStrictEqual(conversationLines([{}, { role: 'user' }]).lineas, []);
  });
});

describe('subjectLine — que se entienda SIN abrir el correo', () => {
  test('EL CASO REAL: antes decía "Llamada CONSULTA — +34666351319 (1:38)"', () => {
    const s = subjectLine({ outcome: 'info', callerNumber: '+34666351319', durationFormatted: '1:38', transcript: TRANSCRIPT });
    assert.match(s, /barandillas/, `el asunto sigue sin decir de qué iba: ${s}`);
    assert.match(s, /\+34666351319/);
  });

  test('una reserva se anuncia como reserva, con cliente, servicio y cuándo', () => {
    const s = subjectLine({
      outcome: 'booked', callerNumber: '+34600111222',
      bookedAppointment: { patientName: 'Ana Gómez', service: 'Barandilla', date: '2026-08-04', time: '10:00' },
      transcript: TRANSCRIPT,
    });
    assert.match(s, /Cita nueva/);
    assert.match(s, /Ana Gómez/);
    assert.match(s, /2026-08-04/);
  });

  test('colgaron sin hablar → se dice, no se finge una consulta', () => {
    const s = subjectLine({ outcome: 'abandoned', callerNumber: '+34600111222', durationFormatted: '0:08', transcript: [] });
    assert.match(s, /colgada sin hablar/);
  });

  test('un asunto largo se recorta: los clientes de correo lo cortan igual', () => {
    const t = [{ role: 'user', content: 'Buenas '.repeat(40) }];
    const s = subjectLine({ outcome: 'info', callerNumber: '+34600111222', transcript: t });
    assert.ok(s.length < 90, `asunto de ${s.length} caracteres`);
    assert.ok(s.includes('…'));
  });
});
