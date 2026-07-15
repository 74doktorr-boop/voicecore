// ============================================================
// NodeFlow — getCost atribuye por el proveedor REAL (auditoría 2026-07-16).
// Antes aplicaba SIEMPRE twilio + openai aunque corriera Telnyx + Groq → el
// margen del panel era ficción. Ahora la tarifa depende de session.provider y
// del modelo (groq/… vs openai/…).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { CallSession } = require('../src/core/call-session');

function sessionOf({ provider, model, ttsProvider }) {
  const s = new CallSession({
    callId: 'c1', assistant: { id: 'o1', model, ttsProvider, systemPrompt: 'x', tools: [] },
    callerNumber: '+34600', calledNumber: '+34843', direction: 'inbound',
  });
  s.provider = provider;
  s.startTime = 0; s.endTime = 60000; // 1 minuto exacto
  return s;
}

describe('getCost — atribución por proveedor real', () => {
  test('Telnyx + Groq → tarifas de Telnyx y Groq, no Twilio/OpenAI', () => {
    const c = sessionOf({ provider: 'telnyx', model: 'groq/llama-3.3-70b-versatile', ttsProvider: 'elevenlabs' });
    const cost = c.getCost();
    assert.strictEqual(cost.telephonyProvider, 'telnyx');
    assert.strictEqual(cost.llmProvider, 'groq');
    // 1 min: telnyx 0.0045 + deepgram 0.0043 + groq 0.0015 + eleven 0.10
    assert.ok(Math.abs(cost.telephony - 0.0045) < 1e-9, 'telefonía = tarifa Telnyx');
    assert.ok(Math.abs(cost.llm - 0.0015) < 1e-9, 'LLM = tarifa Groq');
    assert.ok(Math.abs(cost.total - (0.0045 + 0.0043 + 0.0015 + 0.10)) < 1e-9);
  });

  test('Twilio histórico + OpenAI → tarifas legadas', () => {
    const c = sessionOf({ provider: 'twilio', model: 'openai/gpt-4o-mini', ttsProvider: 'openai' });
    const cost = c.getCost();
    assert.strictEqual(cost.llmProvider, 'openai');
    assert.ok(Math.abs(cost.telephony - 0.018) < 1e-9, 'telefonía = tarifa Twilio');
    assert.ok(Math.abs(cost.llm - 0.005) < 1e-9, 'LLM = tarifa OpenAI');
  });

  test('alias .twilio se conserva (retro-compat del panel) y = telephony', () => {
    const c = sessionOf({ provider: 'telnyx', model: 'openai/gpt-4o-mini', ttsProvider: 'openai' });
    const cost = c.getCost();
    assert.strictEqual(cost.twilio, cost.telephony);
  });
});
