// ============================================================
// NodeFlow — Perfilado de alta (onboarding self-serve, 2026-07-04)
// El cliente describe su negocio → sector + modo deducidos solos.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { profileBusiness, _deterministicMatch } = require('../src/sectors/onboarding-profiler');

function fakeOpenAI(sectorOrDraft) {
  return {
    chat: { completions: { create: async ({ messages }) => {
      const sys = messages[0].content;
      // La clasificación pide {"sector":...}; el borrador pide un JSON de sector.
      const content = sys.includes('Clasifica un negocio')
        ? JSON.stringify({ sector: sectorOrDraft.classify })
        : JSON.stringify(sectorOrDraft.draft || {});
      return { choices: [{ message: { content } }] };
    } } },
  };
}

describe('_deterministicMatch — sin LLM, por etiqueta/alias', () => {
  test('detecta el sector por su nombre en el texto', () => {
    assert.strictEqual(_deterministicMatch('Tengo una peluquería en Bilbao'), 'peluqueria');
    assert.strictEqual(_deterministicMatch('clínica dental familiar'), 'dental');
    assert.strictEqual(_deterministicMatch('taller de coches'), 'taller');
  });
  test('sin coincidencia → null', () => {
    assert.strictEqual(_deterministicMatch('vendemos miel artesana'), null);
  });
});

describe('profileBusiness', () => {
  test('match determinista → sector + modo, sin tocar el LLM', async () => {
    const p = await profileBusiness({ name: 'Peluquería Laura', description: 'cortes y tintes' }, { openai: null });
    assert.strictEqual(p.sector, 'peluqueria');
    assert.strictEqual(p.matched, true);
    assert.strictEqual(p.mode, 'citas');
  });

  test('sector de contacto → modo contacto (p.ej. reformas)', async () => {
    const p = await profileBusiness({ name: 'Reformas García', description: 'obras y reformas integrales' }, { openai: null });
    assert.strictEqual(p.sector, 'reformas');
    assert.strictEqual(p.mode, 'contacto');
  });

  test('sin match determinista → LLM clasifica', async () => {
    const p = await profileBusiness(
      { name: 'La Bocanada', description: 'servimos comidas y cenas con reserva' },
      { openai: fakeOpenAI({ classify: 'restaurante' }) },
    );
    assert.strictEqual(p.sector, 'restaurante');
    assert.strictEqual(p.matched, true);
  });

  test('ningún sector encaja → generico + borrador sugerido (pendiente de aprobación)', async () => {
    const p = await profileBusiness(
      { name: 'Cera y Miel', description: 'apicultura y venta de miel' },
      { openai: fakeOpenAI({ classify: 'none', draft: {
        label: 'Apicultura', norms: ['Pregunta qué producto quiere y cantidad.'],
        metricChecks: [{ key: 'producto', label: '¿Capturó el producto?' }],
      } }) },
    );
    assert.strictEqual(p.sector, 'generico');
    assert.strictEqual(p.matched, false);
    assert.ok(p.suggested && p.suggested.slug === 'apicultura');
    assert.ok(p.suggested.draft.norms.length >= 1);
  });

  test('sin descripción o sin LLM y sin match → generico (no rompe)', async () => {
    assert.strictEqual((await profileBusiness({}, { openai: null })).sector, 'generico');
    const p = await profileBusiness({ name: 'Cosa rara sin pistas' }, { openai: null });
    assert.strictEqual(p.sector, 'generico');
    assert.strictEqual(p.matched, false);
  });
});
