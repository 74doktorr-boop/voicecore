// ============================================================
// VoiceCore — Un lead por llamada (2026-07-07)
// En la llamada real de validación, el LLM invocó register_lead DOS
// veces → lead duplicado y "he anotado tu solicitud" repetido. Regla
// determinista fuera del LLM: la 2ª invocación no crea nada y le dice
// al modelo que responda contenido, no otro acuse.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ToolExecutor } = require('../src/tools/executor');

describe('register_lead — dedupe por llamada', () => {
  test('la segunda invocación en la MISMA llamada no duplica', async () => {
    const ex = new ToolExecutor();
    const session = { callerNumber: '34600111222' };
    const r1 = await ex.registerLead({ name: 'Raúl', need: 'info' }, 'org-1', { session });
    assert.strictEqual(r1.success, true);
    assert.ok(!r1.already_registered, 'la primera sí registra');
    const r2 = await ex.registerLead({ name: 'Raúl', need: 'más info' }, 'org-1', { session });
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.already_registered, true);
    assert.match(r2.message, /NO repitas/i);
  });

  test('llamadas distintas (sesiones distintas) registran cada una la suya', async () => {
    const ex = new ToolExecutor();
    const r1 = await ex.registerLead({ name: 'A' }, 'org-1', { session: { callerNumber: '1' } });
    const r2 = await ex.registerLead({ name: 'B' }, 'org-1', { session: { callerNumber: '2' } });
    assert.ok(!r1.already_registered);
    assert.ok(!r2.already_registered);
  });

  test('sin sesión (contexto raro) no rompe', async () => {
    const ex = new ToolExecutor();
    const r = await ex.registerLead({ name: 'X' }, 'org-1', {});
    assert.strictEqual(r.success, true);
  });
});
