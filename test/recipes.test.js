// Valida que las recetas JSON son estructuralmente correctas y compatibles
// con el motor (se ejecutan de principio a fin con un driver permisivo).
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runRecipe } = require('../src/integrations/recipe-engine');
const { MockDriver } = require('../src/integrations/drivers/mock-driver');

const RECIPES_DIR = path.join(__dirname, '..', 'src', 'integrations', 'recipes');
const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.json'));

const ctx = {
  org: { bookingUrl: 'https://x/osakin', stormPublicUrl: 'https://x/storm' },
  patient: { name: 'Maite', phone: '600111222', email: 'm@x.es', dni: '12345678Z' },
  appt: { sede: 'Tolosa', service: 'Fisioterapia', tipoPermiso: 'conducir', date: '2026-07-02', time: '17:30' },
};

describe('recetas de integración', () => {
  test('hay recetas y están bien formadas', () => {
    assert.ok(files.length >= 2, 'esperaba organizate.json y stormplus.json');
  });

  for (const f of files) {
    test(`${f}: estructura válida + ejecuta de inicio a fin`, async () => {
      const recipe = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, f), 'utf8'));
      assert.ok(recipe.id, 'falta id');
      assert.ok(Array.isArray(recipe.steps) && recipe.steps.length, 'faltan steps');
      for (const s of recipe.steps) assert.ok(s.action, `paso sin action en ${f}`);

      // Driver permisivo (todo existe) + confirmación → la receta debe completar.
      const driver = new MockDriver({ allPresent: true, pageText: 'cita confirmada', texts: {} });
      const r = await runRecipe(recipe, ctx, driver);
      assert.strictEqual(r.ok, true, `${f}: ${r.error || ''}`);
      assert.ok(driver.actions.some(a => a.op === 'goto'), 'debe navegar a la URL');
    });
  }
});
