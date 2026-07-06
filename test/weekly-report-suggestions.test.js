// ============================================================
// NodeFlow — Sugerencias en el informe semanal (2026-07-06)
// El lunes el informe cuenta lo que NodeFlow aprendió de las citas
// y ofrece aplicarlo con un clic (deep-link a Reglas).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildEmailHtml } = require('../src/reports/weekly-report');

const baseStats = { totalCalls: 12, totalMinutes: 40, bookedCalls: 5, totalApts: 7, estValue: 350, topService: 'corte' };
const range = { from: '2026-06-29', to: '2026-07-05' };

describe('buildEmailHtml — bloque de aprendizaje', () => {
  test('sin sugerencias → no aparece el bloque', () => {
    const { html } = buildEmailHtml({ bizName: 'X', range, stats: baseStats, lang: 'es', suggestions: [] });
    assert.doesNotMatch(html, /aprendí de tus citas/);
    assert.doesNotMatch(html, /go=reglas/);
  });

  test('con sugerencias → título, detalle y CTA a Reglas', () => {
    const suggestions = [
      { title: 'Ajustar "Recordar corte de pelo"', detail: 'Vuelven a los 34 días, no 24.' },
      { title: 'Crear seguimiento para "mechas"', detail: '12 citas sin seguimiento.' },
    ];
    const { html, text } = buildEmailHtml({ bizName: 'X', range, stats: baseStats, lang: 'es', suggestions });
    assert.match(html, /Lo que aprendí de tus citas/);
    assert.match(html, /Recordar corte de pelo/);
    assert.match(html, /Crear seguimiento para/);
    assert.match(html, /nodeflow\.es\/portal\/\?go=reglas/);
    assert.match(text, /go=reglas/);
  });

  test('escapa HTML en título/detalle (anti-inyección)', () => {
    const suggestions = [{ title: 'A <b>x</b>', detail: 'B & <script>' }];
    const { html } = buildEmailHtml({ bizName: 'X', range, stats: baseStats, lang: 'es', suggestions });
    assert.match(html, /A &lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /B &amp;/);
    assert.doesNotMatch(html, /<script>/);
  });

  test('i18n gallego traduce el encabezado', () => {
    const { html } = buildEmailHtml({ bizName: 'X', range, stats: baseStats, lang: 'gl', suggestions: [{ title: 'T', detail: 'D' }] });
    assert.match(html, /O que aprendín/);
  });
});
