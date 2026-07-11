// ============================================================
// NodeFlow — Fallback de asistente NEUTRO (fix 2026-07)
// Tema A de la auditoría: si la llamada entrante no resuelve una ORG real
// (config no carga, número no en el pool, hipo de BD), la cadena caía a
// getByPhoneNumber()→getDefault(), que devolvía el PRIMER asistente de
// archivo por orden alfabético = "abogado.json". Resultado: el cliente de
// una fisio oía a un "bufete de abogados" (el incidente "Bienvenido a
// nodeflow" de otra forma). El asistente neutro inline existía pero era
// INALCANZABLE porque getDefault() siempre devolvía un demo de marca.
//
// Fix: un assistants/default.json NEUTRO (id 'default'), que getDefault()
// prefiere → todos los caminos (Telnyx/Twilio/Vonage/webhook) caen a un
// asistente sin marca que toma recado, jamás a un negocio ajeno.
// Este test es el guardarraíl: si alguien borra default.json, falla.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { AssistantManager } = require('../src/assistants/manager');

const mgr = new AssistantManager(path.join(__dirname, '..', 'assistants'));
mgr.loadAll();

describe('Asistente neutro por defecto', () => {
  test('existe un asistente "default" cargado (assistants/default.json)', () => {
    assert.ok(mgr.get('default'), 'debe existir assistants/default.json con id "default"');
  });

  test('getDefault() devuelve el neutro, NO un vertical de marca', () => {
    const d = mgr.getDefault();
    assert.strictEqual(d.id, 'default', `getDefault devolvió "${d.id}" — nunca debe ser abogado/clinica/etc.`);
  });

  test('un número desconocido → asistente neutro, jamás un negocio ajeno', () => {
    const a = mgr.getByPhoneNumber('+34600000000'); // no casa con ninguno
    assert.strictEqual(a.id, 'default', `cayó en "${a.id}" en vez del neutro`);
  });

  test('el neutro NO impersona un negocio (no inventa servicios/precios)', () => {
    const d = mgr.get('default');
    assert.match(
      d.systemPrompt,
      /no dispones de la información|no afirmes ser un negocio|respaldo neutro/i,
      'el prompt del neutro debe prohibir impersonar un negocio',
    );
  });

  test('el neutro no declara un número (solo se usa como respaldo, no casa por número)', () => {
    const d = mgr.get('default');
    assert.ok(!d.phoneNumber && !d.phoneNumbers, 'el default no debe tener número asignado');
  });
});
