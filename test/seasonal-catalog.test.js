// ============================================================
// NodeFlow — Campañas del año (2026-07-07)
// Estacionales de un clic: catálogo curado por sector con fecha y
// texto listos; el cron existente (org_campaigns) las dispara.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { SEASONAL_CATALOG, getSeasonalForSector, findSeasonal } = require('../src/lifecycle/seasonal-catalog');

describe('catálogo estacional — integridad', () => {
  test('fechas válidas, textos con sustancia y keys únicas', () => {
    const seen = new Set();
    for (const [sector, list] of Object.entries(SEASONAL_CATALOG)) {
      for (const c of list) {
        assert.ok(c.month >= 1 && c.month <= 12, `${sector}/${c.key}: mes ${c.month}`);
        assert.ok(c.day >= 1 && c.day <= 28, `${sector}/${c.key}: día ${c.day} (≤28 para existir siempre)`);
        assert.ok(c.text.length >= 40 && c.text.length <= 240, `${sector}/${c.key}: texto ${c.text.length} chars`);
        assert.match(c.key, /^camp_/);
        assert.ok(c.name.length >= 4);
        // Los textos completan "un mensaje de {negocio}: …" → minúscula inicial
        assert.match(c.text[0], /[a-záéíóúü¿¡]/, `${sector}/${c.key}: el texto debe empezar en minúscula`);
        const uniq = sector + '/' + c.key;
        assert.ok(!seen.has(uniq)); seen.add(uniq);
      }
    }
    assert.ok(Object.keys(SEASONAL_CATALOG).length >= 12, 'al menos 12 sectores con campañas');
  });

  test('findSeasonal resuelve por key desde cualquier sector', () => {
    const c = findSeasonal('camp_neumaticos_invierno');
    assert.strictEqual(c.month, 10);
    assert.match(c.text, /neumáticos/);
    assert.strictEqual(findSeasonal('camp_inexistente'), null);
  });

  test('getSeasonalForSector devuelve copia (no el catálogo mutable)', () => {
    const a = getSeasonalForSector('taller');
    a[0].text = 'mutado';
    assert.notStrictEqual(getSeasonalForSector('taller')[0].text, 'mutado');
  });
});
