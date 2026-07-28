// ============================================================
// NodeFlow — Micrositios de cliente (Contenido & SEO, fase 1) 2026-07-28
// La página hosteada por negocio debe: rankear (title/desc/LocalBusiness schema
// + canonical) y reservar (chat embebido con el orgId). Y degradar sin datos.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { renderMicrosite } = require('../src/api/routes-microsite');

const full = {
  id: 'org-123', slug: 'clinica-norte', name: 'Clínica Norte', language: 'es', phone: '+34943111222',
  assistant_config: { sector: 'dental' },
  automation_config: { config: { city: 'Donostia', serviceList: [{ name: 'Limpieza' }, { name: 'Ortodoncia' }] } },
};

describe('renderMicrosite — SEO', () => {
  const h = renderMicrosite(full, 'https://nodeflow.es');
  test('title con negocio, ciudad y sector', () => {
    assert.match(h, /<title>Clínica Norte · Donostia — dental<\/title>/);
  });
  test('canonical y og apuntan a /n/slug', () => {
    assert.match(h, /rel="canonical" href="https:\/\/nodeflow\.es\/n\/clinica-norte"/);
  });
  test('LocalBusiness schema con localidad y teléfono', () => {
    assert.match(h, /"@type":"LocalBusiness"/);
    assert.match(h, /"addressLocality":"Donostia"/);
    assert.match(h, /"telephone":"\+34943111222"/);
  });
  test('meta description con negocio y CTA de cita', () => {
    assert.match(h, /<meta name="description" content="[^"]*Clínica Norte[^"]*cita[^"]*"/i);
  });
});

describe('renderMicrosite — reserva (chat embebido)', () => {
  const h = renderMicrosite(full, 'https://nodeflow.es');
  test('embebe chat.js con el orgId', () => {
    assert.match(h, /src="https:\/\/nodeflow\.es\/chat\.js" data-nodeflow-org="org-123"/);
  });
  test('CTA abre el chat', () => {
    assert.match(h, /Pedir cita ahora/);
    assert.match(h, /nfOpenChat/);
  });
  test('pinta los servicios como chips', () => {
    assert.match(h, /class="chip">Limpieza/);
    assert.match(h, /class="chip">Ortodoncia/);
  });
});

describe('renderMicrosite — degradación', () => {
  test('sin ciudad/servicios/sector no produce "undefined" ni rompe', () => {
    const h = renderMicrosite({ id: 'o2', slug: 'x', name: 'Peluquería X', automation_config: {} }, 'https://nodeflow.es');
    assert.match(h, /Peluquería X/);
    assert.ok(!/undefined/.test(h));
    assert.match(h, /data-nodeflow-org="o2"/);
  });
  test('escapa caracteres peligrosos en el nombre', () => {
    const h = renderMicrosite({ id: 'o3', slug: 'y', name: 'Bar <script>x</script>', automation_config: {} }, 'https://nodeflow.es');
    assert.ok(!/<script>x<\/script>/.test(h.replace(/data-nodeflow-org[^>]*>/, '')));
    assert.match(h, /&lt;script&gt;/);
  });
});
