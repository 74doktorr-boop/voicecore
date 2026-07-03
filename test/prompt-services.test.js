// ============================================================
// NodeFlow — #8 Editor único: el prompt dice los servicios de la TABLA
// y calla el texto libre legacy cuando la tabla existe (antes convivían
// "SERVICIOS: solo corte" + sd.servicios de sector + bloque estructurado
// inyectado por voice-pipeline → tres verdades contradictorias).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

const LIST = [
  { name: 'Corte de pelo', price: '15€', duration: '30 min', notes: '' },
  { name: 'Mechas', price: '60€', duration: '120 min', notes: '' },
];

describe('generatePrompt con serviceList (tabla estructurada)', () => {
  const cfg = {
    sector: 'peluqueria',
    services: 'solo corte de pelo',                 // texto libre legacy
    sectorData: { servicios: 'Corte 12€ (VIEJO)' }, // duplicado legacy de sector
    serviceList: LIST,
  };
  const prompt = generatePrompt(cfg, 'Peluquería HHR');

  test('incluye el bloque estructurado con los datos exactos', () => {
    assert.match(prompt, /SERVICIOS Y PRECIOS \(datos EXACTOS/);
    assert.match(prompt, /Corte de pelo: 15€ \(30 min\)/);
  });

  test('NO emite el texto libre legacy ni el duplicado de sector', () => {
    assert.doesNotMatch(prompt, /SERVICIOS: solo corte de pelo/);
    assert.doesNotMatch(prompt, /VIEJO/);
  });
});

describe('generatePrompt SIN serviceList (org legacy sin tabla)', () => {
  const prompt = generatePrompt(
    { sector: 'peluqueria', services: 'solo corte', sectorData: { servicios: 'Corte 12€' } },
    'Legacy SL'
  );

  test('conserva el comportamiento anterior (texto libre visible)', () => {
    assert.match(prompt, /SERVICIOS Y PRECIOS:\nCorte 12€/);
  });
});
