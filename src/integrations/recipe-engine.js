// ============================================================
// NodeFlow — Motor de RPA declarativo ("recetas")
// ------------------------------------------------------------
// Las webs sin API (Organízate, StormPlus, …) se automatizan con un
// navegador headless. Para NO programar cada web a pelo (frágil e
// irrepetible), describimos la automatización como una RECETA: una
// lista de pasos declarativos (goto, fill, click, expectText, …).
//
// Ventajas:
//   • Reusable: un cliente nuevo con el mismo software = mismo recipe.
//   • Resiliente: cada paso admite VARIOS selectores candidatos; si el
//     primero no está, prueba el siguiente (sobrevive a cambios de UI).
//   • Driver-agnóstico: el motor no sabe de Playwright. Se le inyecta un
//     "driver" (Playwright en prod, mock en tests) → 100% testeable.
//   • Evidencia: capturas en cada hito para auditoría/depuración.
//
// El motor NUNCA lanza hacia arriba: devuelve { ok, ... }. Si algo falla,
// el orquestador (booking-service) dispara el fallback humano.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('RPA');

/** Resuelve plantillas {{a.b.c}} contra un contexto anidado. */
function resolveTemplate(value, ctx) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    return v == null ? '' : String(v);
  });
}

/** Normaliza a array de candidatos (acepta `selector` único o `selectorCandidates`). */
function candidatesOf(step) {
  if (Array.isArray(step.selectorCandidates)) return step.selectorCandidates;
  if (step.selector) return [step.selector];
  return [];
}

/**
 * Ejecuta una operación del driver probando los selectores candidatos en orden.
 * Devuelve el resultado del primero que funciona; si ninguno, lanza.
 */
async function tryCandidates(driver, op, candidates, ...args) {
  let lastErr;
  for (const sel of candidates) {
    try {
      if (typeof driver.exists === 'function') {
        const present = await driver.exists(sel);
        if (!present) { lastErr = new Error(`no presente: ${sel}`); continue; }
      }
      return await driver[op](sel, ...args);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`ningún selector funcionó (${op})`);
}

/**
 * Ejecuta una receta paso a paso.
 * @param {object} recipe  - { id, name, steps: [...] }
 * @param {object} ctx     - datos para las plantillas (patient, appt, org, ...)
 * @param {object} driver  - implementación del navegador (Playwright o mock)
 * @param {object} [opts]  - { onStep?: (info)=>void }
 * @returns {Promise<{ok, recipeId, steps, evidence, captured, error}>}
 */
async function runRecipe(recipe, ctx, driver, opts = {}) {
  const onStep = opts.onStep || (() => {});
  const result = { ok: false, recipeId: recipe.id, steps: [], evidence: [], captured: {}, error: null };

  for (let i = 0; i < (recipe.steps || []).length; i++) {
    const step = recipe.steps[i];
    const cands = candidatesOf(step).map(s => resolveTemplate(s, ctx));
    const value = resolveTemplate(step.value, ctx);
    const label = `${i + 1}.${step.action}`;
    try {
      switch (step.action) {
        case 'goto':
          await driver.goto(resolveTemplate(step.url, ctx)); break;
        case 'click':
          await tryCandidates(driver, 'click', cands); break;
        case 'fill':
          await tryCandidates(driver, 'fill', cands, value); break;
        case 'select':
          await tryCandidates(driver, 'selectOption', cands, value); break;
        case 'waitFor':
          await tryCandidates(driver, 'waitFor', cands, step.timeout || 8000); break;
        case 'sleep':
          await new Promise(r => setTimeout(r, step.ms || 500)); break;
        case 'readText': {
          const txt = await tryCandidates(driver, 'getText', cands);
          if (step.saveAs) result.captured[step.saveAs] = (txt || '').trim();
          break;
        }
        case 'expectText': {
          const needles = (step.anyOf || [step.text]).filter(Boolean).map(s => s.toLowerCase());
          const page = (await driver.pageText()).toLowerCase();
          if (!needles.some(n => page.includes(n))) {
            throw new Error(`no se encontró confirmación esperada: ${needles.join(' | ')}`);
          }
          break;
        }
        case 'screenshot': {
          const shot = await driver.screenshot(step.name || label);
          if (shot) result.evidence.push({ name: step.name || label, ref: shot });
          break;
        }
        default:
          throw new Error(`acción desconocida: ${step.action}`);
      }
      result.steps.push({ step: label, ok: true });
      onStep({ index: i, label, ok: true });
    } catch (e) {
      if (step.optional) {
        result.steps.push({ step: label, ok: true, skipped: true });
        onStep({ index: i, label, ok: true, skipped: true });
        continue; // un paso opcional que falla no rompe la receta
      }
      result.error = `Paso ${label} falló: ${e.message}`;
      result.steps.push({ step: label, ok: false, error: e.message });
      onStep({ index: i, label, ok: false, error: e.message });
      log.warn(`Receta ${recipe.id} → ${result.error}`);
      try { const s = await driver.screenshot(`error-${label}`); if (s) result.evidence.push({ name: `error-${label}`, ref: s }); } catch (_) {}
      return result; // aborta; el orquestador hará fallback humano
    }
  }

  result.ok = true;
  return result;
}

module.exports = { runRecipe, resolveTemplate, tryCandidates, candidatesOf };
