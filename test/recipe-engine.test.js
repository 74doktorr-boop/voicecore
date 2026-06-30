// ============================================================
// NodeFlow — Tests del motor de RPA por recetas.
// Verifica resolución de plantillas, selectores resilientes,
// captura de datos, evidencia, pasos opcionales y el corte ante fallo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { runRecipe, resolveTemplate } = require('../src/integrations/recipe-engine');
const { MockDriver } = require('../src/integrations/drivers/mock-driver');

const ctx = {
  bookingUrl: 'https://reservas.example/osakin',
  patient: { name: 'Maite Aierbe', phone: '600111222' },
  appt: { service: 'Fisioterapia', date: '2026-07-02', time: '17:30' },
};

const recipe = {
  id: 'demo',
  name: 'Demo',
  steps: [
    { action: 'goto', url: '{{bookingUrl}}' },
    { action: 'click', selectorCandidates: ['text=Pedir cita', '#pedir'], optional: true },
    { action: 'fill', selectorCandidates: ['#nombre', 'input[name=nombre]'], value: '{{patient.name}}' },
    { action: 'fill', selector: '#telefono', value: '{{patient.phone}}' },
    { action: 'select', selector: '#servicio', value: '{{appt.service}}' },
    { action: 'readText', selector: '#ref', saveAs: 'referencia' },
    { action: 'expectText', anyOf: ['cita confirmada', 'reserva realizada'] },
    { action: 'screenshot', name: 'confirmacion' },
  ],
};

describe('recipe-engine', () => {
  test('resolveTemplate sustituye rutas anidadas', () => {
    assert.strictEqual(resolveTemplate('Hola {{patient.name}}', ctx), 'Hola Maite Aierbe');
    assert.strictEqual(resolveTemplate('{{appt.date}} {{appt.time}}', ctx), '2026-07-02 17:30');
    assert.strictEqual(resolveTemplate('{{no.existe}}', ctx), '');
  });

  test('ejecuta la receta completa y rellena con datos del contexto', async () => {
    const driver = new MockDriver({
      present: ['#nombre', '#telefono', '#servicio', '#ref', 'text=Pedir cita'],
      pageText: 'Su cita confirmada para el 2 de julio',
      texts: { '#ref': '  REF-12345  ' },
    });
    const r = await runRecipe(recipe, ctx, driver);
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(driver.filledValue('#nombre'), 'Maite Aierbe');
    assert.strictEqual(driver.filledValue('#telefono'), '600111222');
    assert.strictEqual(r.captured.referencia, 'REF-12345');      // readText recortado
    assert.ok(r.evidence.some(e => e.name === 'confirmacion'));   // captura final
  });

  test('selectores resilientes: usa el segundo candidato si el primero no está', async () => {
    const driver = new MockDriver({
      present: ['input[name=nombre]', '#telefono', '#servicio', '#ref'],
      pageText: 'reserva realizada',
    });
    const r = await runRecipe(recipe, ctx, driver);
    assert.strictEqual(r.ok, true, r.error || '');
    // El #nombre no existía → usó input[name=nombre]
    assert.strictEqual(driver.filledValue('input[name=nombre]'), 'Maite Aierbe');
  });

  test('un paso OPCIONAL que no encuentra selector no rompe la receta', async () => {
    const driver = new MockDriver({
      present: ['#nombre', '#telefono', '#servicio', '#ref'], // sin "text=Pedir cita"
      pageText: 'cita confirmada',
    });
    const r = await runRecipe(recipe, ctx, driver);
    assert.strictEqual(r.ok, true, r.error || '');
    assert.ok(r.steps.find(s => s.step === '2.click')?.skipped);
  });

  test('si NO aparece el texto de confirmación → ok:false + captura de error (para fallback)', async () => {
    const driver = new MockDriver({
      present: ['#nombre', '#telefono', '#servicio', '#ref'],
      pageText: 'ha ocurrido un error inesperado',
    });
    const r = await runRecipe(recipe, ctx, driver);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /expectText|confirmaci/i);
    assert.ok(r.evidence.some(e => e.name.startsWith('error-')), 'captura del error para depurar');
  });

  test('dry-run salta los pasos skipOnDryRun (rellena pero NO envía)', async () => {
    const dr = {
      id: 'dr',
      steps: [
        { action: 'fill', selector: '#nombre', value: '{{patient.name}}' },
        { action: 'screenshot', name: 'antes-de-enviar' },
        { action: 'click', skipOnDryRun: true, selector: '#enviar' },
        { action: 'expectText', skipOnDryRun: true, anyOf: ['cita confirmada'] },
      ],
    };
    const driver = new MockDriver({ present: ['#nombre', '#enviar'], pageText: 'formulario vacio' });
    const r = await runRecipe(dr, ctx, driver, { dryRun: true });
    assert.strictEqual(r.ok, true, 'completa sin enviar');
    assert.ok(!driver.didClick('#enviar'), 'NO debe pulsar enviar en dry-run');
    assert.strictEqual(driver.filledValue('#nombre'), 'Maite Aierbe', 'sí rellena');
    assert.ok(r.steps.find(s => s.step === '3.click')?.skipped, 'el envío queda marcado como saltado');
  });

  test('un paso obligatorio sin selector disponible aborta limpiamente (no lanza)', async () => {
    const driver = new MockDriver({ present: [], pageText: '' });
    const r = await runRecipe(recipe, ctx, driver);
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('3.fill'), 'falla en el primer paso obligatorio sin selector');
  });
});
