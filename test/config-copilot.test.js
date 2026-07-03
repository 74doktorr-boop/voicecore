// ============================================================
// NodeFlow — Copiloto de configuración (#8, idea de Unai
// 2026-07-04): el dueño lo dice con sus palabras ("corte 15 euros
// media hora, tinte 45 hora y media") y el copiloto propone el
// formato estructurado. SIEMPRE propuesta → confirmación del dueño
// → el Guardar normal persiste. El LLM solo redacta la propuesta;
// estos validadores deterministas son los que deciden qué entra.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  validateServicesProposal, validateScheduleProposal, parseConfigText,
} = require('../src/assistants/config-copilot');

describe('validateServicesProposal — el JSON del LLM no entra sin pasar por aquí', () => {
  test('filas válidas se normalizan (strings recortados, campos opcionales)', () => {
    const out = validateServicesProposal({ services: [
      { name: '  Corte de pelo ', price: '15€', duration: '30 min', notes: 'incluye lavado' },
      { name: 'Tinte', price: 'a presupuesto' },
    ] });
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(out[0], { name: 'Corte de pelo', price: '15€', duration: '30 min', notes: 'incluye lavado' });
    assert.deepStrictEqual(out[1], { name: 'Tinte', price: 'a presupuesto', duration: '', notes: '' });
  });

  test('sin nombre no hay fila; máximo 60; strings acotados', () => {
    const out = validateServicesProposal({ services: [
      { price: '10€' },
      { name: 'x'.repeat(200), price: 'y'.repeat(99) },
    ] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].name.length, 80);
    assert.strictEqual(out[0].price.length, 30);
  });

  test('basura → lista vacía sin lanzar', () => {
    assert.deepStrictEqual(validateServicesProposal(null), []);
    assert.deepStrictEqual(validateServicesProposal({ services: 'no-array' }), []);
  });
});

describe('validateScheduleProposal — horas HH:MM y días conocidos, nada más', () => {
  test('días válidos con mañana y tarde pasan; null = cerrado', () => {
    const out = validateScheduleProposal({ schedule: {
      mon: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
      sat: { open: '09:00', close: '14:00' },
      sun: null,
    } });
    assert.deepStrictEqual(Object.keys(out).sort(), ['mon', 'sat', 'sun']);
    assert.strictEqual(out.mon.afternoon_open, '16:00');
    assert.strictEqual(out.sun, null);
  });

  test('horas inválidas o días desconocidos se descartan', () => {
    const out = validateScheduleProposal({ schedule: {
      mon: { open: '9', close: '14:00' },        // hora mal formada → día fuera
      xyz: { open: '09:00', close: '14:00' },     // día desconocido → fuera
      tue: { open: '09:30', close: '20:00' },
    } });
    assert.deepStrictEqual(Object.keys(out), ['tue']);
  });

  test('basura → objeto vacío sin lanzar', () => {
    assert.deepStrictEqual(validateScheduleProposal(null), {});
    assert.deepStrictEqual(validateScheduleProposal({ schedule: [] }), {});
  });
});

describe('parseConfigText — orquestación con LLM inyectado', () => {
  function fakeOpenAI(payload) {
    return { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) } } };
  }

  test('services: texto del dueño → propuesta validada', async () => {
    const out = await parseConfigText('services', 'corte quince euros media hora y tinte a presupuesto', {
      openai: fakeOpenAI({ services: [
        { name: 'Corte de pelo', price: '15€', duration: '30 min' },
        { name: 'Tinte', price: 'a presupuesto' },
      ] }),
    });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.services.length, 2);
  });

  test('schedule: texto → propuesta validada', async () => {
    const out = await parseConfigText('schedule', 'de lunes a viernes de 9 a 2 y de 4 a 8, sábados solo mañana', {
      openai: fakeOpenAI({ schedule: { mon: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' }, sat: { open: '09:00', close: '14:00' }, sun: null } }),
    });
    assert.strictEqual(out.ok, true);
    assert.ok(out.schedule.mon);
  });

  test('propuesta vacía tras validar → ok:false con mensaje honesto', async () => {
    const out = await parseConfigText('services', 'ehhh no sé', { openai: fakeOpenAI({ services: [] }) });
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /no he entendido/i);
  });

  test('kind desconocido o texto vacío → ok:false sin llamar al LLM', async () => {
    const out1 = await parseConfigText('otra-cosa', 'texto', { openai: null });
    assert.strictEqual(out1.ok, false);
    const out2 = await parseConfigText('services', '   ', { openai: null });
    assert.strictEqual(out2.ok, false);
  });

  test('LLM roto → ok:false sin lanzar', async () => {
    const broken = { chat: { completions: { create: async () => { throw new Error('boom'); } } } };
    const out = await parseConfigText('services', 'corte 15', { openai: broken });
    assert.strictEqual(out.ok, false);
  });
});
