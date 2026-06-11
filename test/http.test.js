// ============================================================
// NodeFlow — Tests de integración HTTP (rutas Express reales)
// Monta una app Express mínima con las rutas a probar y hace
// peticiones reales por la red (puerto efímero). Sin supertest:
// usa express (ya es dependencia) + fetch nativo (Node 18+).
//
// En entorno test la DB está deshabilitada, así que probamos las
// rutas de validación/seguridad que NO dependen de Supabase.
// ============================================================

'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-smoke-tests-only';
process.env.NODE_ENV   = 'test';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { setupWidgetRoutes } = require('../src/api/routes-widget');

// ── Levanta una app de prueba con las rutas del widget ───────────────────────
let server, base;

before(async () => {
  const app = express();
  // Mismo parser que producción (con captura de rawBody)
  app.use(express.json({ limit: '512kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  setupWidgetRoutes(app);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => { if (server) server.close(); });

function post(path, body, headers = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Widget callback — validación de entrada
// ═════════════════════════════════════════════════════════════════════════════

describe('HTTP POST /api/widget/callback', () => {
  test('400 si falta orgId', async () => {
    const r = await post('/api/widget/callback', { phone: '612345678' });
    assert.strictEqual(r.status, 400);
    const j = await r.json();
    assert.match(j.error, /orgId/i);
  });

  test('400 si el teléfono es inválido', async () => {
    const r = await post('/api/widget/callback', { orgId: 'org_x', phone: '123' });
    assert.strictEqual(r.status, 400);
    const j = await r.json();
    assert.match(j.error, /tel/i);
  });

  test('rechaza teléfono con letras', async () => {
    const r = await post('/api/widget/callback', { orgId: 'org_x', phone: 'abcdefghi' });
    assert.strictEqual(r.status, 400);
  });

  test('con datos válidos pero sin DB → 503 (no 400)', async () => {
    // En test la DB está off: la validación pasa y llega al check de DB.
    const r = await post('/api/widget/callback', { orgId: 'org_x', phone: '612345678', name: 'Ana' });
    assert.strictEqual(r.status, 503);
  });

  test('CORS: preflight OPTIONS responde 204 con Allow-Origin', async () => {
    const r = await fetch(base + '/api/widget/callback', { method: 'OPTIONS' });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
  });

  test('rate limit: a la 9ª petición desde la misma IP → 429', async () => {
    // El límite es 8/10min. Hacemos 8 válidas-en-forma (caen en 503 por DB) y la 9ª debe ser 429.
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await post('/api/widget/callback', { orgId: 'org_rl', phone: '612345678' });
      if (r.status === 429) { got429 = true; break; }
    }
    assert.ok(got429, 'esperaba un 429 tras superar el límite');
  });
});
