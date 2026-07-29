// ============================================================
// NodeFlow — Si no podemos atender, al menos lo decimos (auditoría 2026-07-29)
//
// Al alcanzar el tope de llamadas simultáneas (10 por negocio por defecto), el
// pipeline devolvía null y el handler cerraba el WebSocket SIN decirle nada al
// que llamaba: silencio y a colgar. Mientras tanto la web prometía "0 llamadas
// sin atender" y "atiende el 100%". De las cuatro causas de no-atención que
// encontró la auditoría, esta era la más probable en la vida real.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generateBusyTeXML, generateTeXML } = require('../src/telephony/telnyx-handler');
const { VoicePipeline } = require('../src/core/voice-pipeline');

describe('generateBusyTeXML', () => {
  test('habla antes de colgar (y no abre stream, que costaría dinero)', () => {
    const xml = generateBusyTeXML('es');
    assert.match(xml, /<Say/);
    assert.match(xml, /<Hangup\s*\/>/);
    assert.ok(!xml.includes('<Stream'), 'un negocio saturado no debe abrir STT/LLM/TTS');
  });

  test('el mensaje explica y deja una salida, no es un "adiós" seco', () => {
    const xml = generateBusyTeXML('es');
    assert.match(xml, /atendiendo otras llamadas/);
    assert.match(xml, /de nuevo en unos minutos/);
  });

  test('en el idioma del asistente', () => {
    assert.match(generateBusyTeXML('gl'), /atendendo outras chamadas/);
    assert.match(generateBusyTeXML('eu'), /beste dei batzuk/);
  });

  test('los combos (es+gl, es+eu) resuelven por el idioma base', () => {
    assert.match(generateBusyTeXML('es+gl'), /atendiendo otras llamadas/);
    assert.match(generateBusyTeXML(), /atendiendo otras llamadas/);
    assert.match(generateBusyTeXML(null), /atendiendo otras llamadas/);
  });

  test('es XML válido y bien formado (Telnyx lo rechazaría si no)', () => {
    const xml = generateBusyTeXML('es');
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.match(xml, /<Response>[\s\S]*<\/Response>$/);
  });

  test('el TeXML normal SIGUE abriendo el stream (no se rompe el camino bueno)', () => {
    const xml = generateTeXML('wss://x/telnyx-stream?t=abc', 'org-1');
    assert.match(xml, /<Stream/);
    assert.ok(!xml.includes('<Hangup'));
  });
});

describe('isAssistantBusy', () => {
  const conLlamadas = (n, assistantId = 'org-1', limite = 10) => {
    const p = Object.create(VoicePipeline.prototype);
    p.maxConcurrentPerAssistant = limite;
    p.activeCalls = new Map();
    for (let i = 0; i < n; i++) p.activeCalls.set(`c${i}`, { assistant: { id: assistantId } });
    return p;
  };

  test('por debajo del tope → no está saturado', () => {
    const r = conLlamadas(3).isAssistantBusy({ id: 'org-1' });
    assert.strictEqual(r.busy, false);
    assert.strictEqual(r.active, 3);
    assert.strictEqual(r.limit, 10);
  });

  test('justo en el tope → saturado (el que llama sería el 11º)', () => {
    assert.strictEqual(conLlamadas(10).isAssistantBusy({ id: 'org-1' }).busy, true);
  });

  test('las llamadas de OTRO negocio no cuentan', () => {
    const p = conLlamadas(10, 'org-otro');
    assert.strictEqual(p.isAssistantBusy({ id: 'org-1' }).busy, false,
      'el cap es por negocio: la saturación de uno no puede tumbar a otro');
  });

  test('respeta el límite propio del asistente si lo tiene', () => {
    const p = conLlamadas(3);
    assert.strictEqual(p.isAssistantBusy({ id: 'org-1', concurrentCalls: 2 }).busy, true);
    assert.strictEqual(p.isAssistantBusy({ id: 'org-1', concurrentCalls: 50 }).busy, false);
  });
});
