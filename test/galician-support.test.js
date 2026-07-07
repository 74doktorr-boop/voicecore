// ============================================================
// NodeFlow — Soporte de GALLEGO de punta a punta
// El asistente de un negocio gallego debe HABLAR y ENTENDER galego:
// cortesía nativa, prompt que responde en galego, y los parsers
// deterministas de fecha/hora reconociendo palabras gallegas
// ("mércores", "as oito e media"). Cada caso es algo real de una llamada.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { timeOfDayGreeting, farewell, defaultFirstMessage, baseLang } = require('../src/assistants/i18n');
const { formatLanguage } = require('../src/assistants/prompt-generator');
const { parseSpanishDate } = require('../src/scheduling/date-parser');
const { parseSpanishTime } = require('../src/scheduling/time-parser');

describe('i18n — cortesía por idioma', () => {
  test('saludo horario en galego', () => {
    assert.strictEqual(timeOfDayGreeting('gl', 10), 'Bos días');
    assert.strictEqual(timeOfDayGreeting('gl', 17), 'Boas tardes');
    assert.strictEqual(timeOfDayGreeting('gl', 23), 'Boas noites');
  });
  test('bilingüe abre en la lengua propia (galego/euskera)', () => {
    assert.strictEqual(baseLang('es+gl'), 'gl');
    assert.strictEqual(baseLang('es+eu'), 'eu');
    assert.strictEqual(timeOfDayGreeting('es+gl', 10), 'Bos días');
  });
  test('desconocido / vacío → español', () => {
    assert.strictEqual(baseLang(''), 'es');
    assert.strictEqual(timeOfDayGreeting(undefined, 10), 'Buenos días');
  });
  test('primer mensaje por defecto en galego', () => {
    assert.match(defaultFirstMessage('gl', 'Clínica Nós'), /chamou a Clínica Nós.*axudarlle/);
    assert.match(defaultFirstMessage('es', 'X'), /ha llamado a X/);
  });
  test('transparencia IA: los saludos por defecto se presentan como asistente (AI Act)', () => {
    assert.match(defaultFirstMessage('es', 'X'), /asistente virtual/i);
    assert.match(defaultFirstMessage('gl', 'X'), /asistente virtual/i);
    assert.match(defaultFirstMessage('eu', 'X'), /laguntzaile birtuala/i);
    assert.match(defaultFirstMessage('es+gl', 'X'), /asistente virtual/i);
  });
  test('despedida del cierre automático en galego', () => {
    assert.match(farewell('gl', 'silence'), /cortou a liña/);
    assert.match(farewell('gl', 'maxlen'), /deixalo aquí/);
    assert.match(farewell('es', 'silence'), /cortado la línea/);
  });
});

describe('prompt — idioma de respuesta', () => {
  test('gl → responde exclusivamente en gallego', () => {
    assert.match(formatLanguage('gl'), /gallego|galego/);
    assert.match(formatLanguage('gl'), /nunca en castellano/);
  });
  test('es+gl → responde en el idioma del cliente', () => {
    assert.match(formatLanguage('es+gl'), /español o gallego/);
  });
  test('es (default) sigue intacto', () => {
    assert.match(formatLanguage('es'), /español de España/);
  });
});

describe('parseSpanishDate — días y meses en galego', () => {
  const today = '2026-07-06'; // luns
  const cases = [
    ['mércores', '2026-07-08'],
    ['o xoves', '2026-07-09'],
    ['venres', '2026-07-10'],
    ['hoxe', '2026-07-06'],
    ['mañá', '2026-07-07'],
    ['pasado mañá', '2026-07-08'],
    ['15 de xullo', '2026-07-15'],
    ['3 de setembro', '2026-09-03'],
    ['1 de xaneiro', '2027-01-01'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      assert.strictEqual(parseSpanishDate(input, today), expected);
    });
  }
  test('español sigue funcionando', () => {
    assert.strictEqual(parseSpanishDate('miércoles', today), '2026-07-08');
    assert.strictEqual(parseSpanishDate('15 de julio', today), '2026-07-15');
  });
});

describe('parseSpanishTime — horas habladas en galego', () => {
  const cases = [
    ['as oito', '08:00'],
    ['as oito e media', '08:30'],
    ['as dez e cuarto', '10:15'],
    ['as seis e vinte', '18:20'],
    ['a unha', '13:00'],
    ['as nove menos cuarto', '08:45'],
    ['as catro da tarde', '16:00'],
    ['as sete e vinte e cinco', '19:25'],
    ['as nove da noite', '21:00'],
    ['medianoite', '00:00'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      assert.strictEqual(parseSpanishTime(input), expected);
    });
  }
  test('español sigue funcionando', () => {
    assert.strictEqual(parseSpanishTime('a la una'), '13:00');
    assert.strictEqual(parseSpanishTime('ocho y media'), '08:30'); // 8-12 se quedan en mañana
  });
});
