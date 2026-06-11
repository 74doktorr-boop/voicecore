// ============================================================
// NodeFlow — Smoke Tests
// Ejecutar: npm test  (node --test test/)
// Sin dependencias externas — usa node:test nativo (Node 18+).
//
// Cubre los caminos críticos que, si se rompen, afectan a
// clientes de pago: auth JWT, reserva de citas (double-booking),
// rate limiting y normalización de teléfonos.
// ============================================================

'use strict';

// Env mínimo ANTES de cargar módulos (los módulos leen env al evaluar)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-smoke-tests-only';
process.env.NODE_ENV   = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Crea un token con la misma lógica HMAC que routes-auth (createSessionToken no está exportado). */
function craftToken(payload, secret = process.env.JWT_SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/** Mock mínimo de req/res de Express para middlewares. */
function mockReqRes({ ip = '1.2.3.4' } = {}) {
  const req = { ip, headers: {}, query: {}, connection: {} };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Auth — JWT de sesión del portal
// ═════════════════════════════════════════════════════════════════════════════

describe('auth: verifySessionToken', () => {
  const { verifySessionToken } = require('../src/api/routes-auth');

  test('acepta un token válido y devuelve el payload', () => {
    const token = craftToken({ email: 'cliente@negocio.com', exp: Date.now() + 60_000 });
    const payload = verifySessionToken(token);
    assert.strictEqual(payload.email, 'cliente@negocio.com');
  });

  test('rechaza un token con firma manipulada', () => {
    const token = craftToken({ email: 'a@b.com', exp: Date.now() + 60_000 });
    const [h, b] = token.split('.');
    const tampered = `${h}.${b}.${'x'.repeat(43)}`;
    assert.throws(() => verifySessionToken(tampered));
  });

  test('rechaza un token con payload modificado tras firmar', () => {
    const token = craftToken({ email: 'a@b.com', exp: Date.now() + 60_000 });
    const [h, , s] = token.split('.');
    const evilBody = Buffer.from(JSON.stringify({ email: 'admin@nodeflow.es', exp: Date.now() + 9e9 })).toString('base64url');
    assert.throws(() => verifySessionToken(`${h}.${evilBody}.${s}`));
  });

  test('rechaza un token expirado', () => {
    const token = craftToken({ email: 'a@b.com', exp: Date.now() - 1000 });
    assert.throws(() => verifySessionToken(token), /expired/i);
  });

  test('rechaza un token firmado con otro secreto', () => {
    const token = craftToken({ email: 'a@b.com', exp: Date.now() + 60_000 }, 'otro-secreto');
    assert.throws(() => verifySessionToken(token));
  });

  test('rechaza firma de longitud distinta sin lanzar RangeError', () => {
    const token = craftToken({ email: 'a@b.com', exp: Date.now() + 60_000 });
    const [h, b] = token.split('.');
    assert.throws(() => verifySessionToken(`${h}.${b}.corta`), /Invalid signature/);
  });

  test('rechaza basura: null, vacío, malformado', () => {
    assert.throws(() => verifySessionToken(null));
    assert.throws(() => verifySessionToken(''));
    assert.throws(() => verifySessionToken('no.es.un.token.real'));
    assert.throws(() => verifySessionToken('solo-una-parte'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Scheduling — reserva de citas y double-booking
// ═════════════════════════════════════════════════════════════════════════════

describe('scheduler: bookAppointment', () => {
  const { scheduler } = require('../src/scheduling/scheduler');

  const BIZ = 'test-biz-' + Date.now();
  scheduler.setBusinessConfig(BIZ, {
    name: 'Negocio Test',
    timezone: 'Europe/Madrid',
    slotInterval: 15,
    services: [{ id: 'corte', name: 'Corte de pelo', duration: 30, price: 15 }],
    schedule: {
      1: { open: '09:00', close: '14:00' }, 2: { open: '09:00', close: '14:00' },
      3: { open: '09:00', close: '14:00' }, 4: { open: '09:00', close: '14:00' },
      5: { open: '09:00', close: '14:00' }, 6: null, 0: null,
    },
  });

  // Próximo lunes (siempre futuro, siempre laborable)
  const nextMonday = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.toLocaleDateString('sv-SE');
  })();

  test('reserva una cita correctamente', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Ana Test', phone: '612345678',
      service: 'corte', date: nextMonday, time: '10:00',
    });
    assert.strictEqual(r.success, true, JSON.stringify(r));
  });

  test('rechaza double-booking del mismo slot', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Otro Cliente', phone: '699999999',
      service: 'corte', date: nextMonday, time: '10:00',
    });
    assert.strictEqual(r.success, false);
    assert.match(r.error || '', /ocupada/i);
  });

  test('rechaza solapamiento parcial (10:15 pisa la cita de 10:00-10:30)', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Tercero', phone: '688888888',
      service: 'corte', date: nextMonday, time: '10:15',
    });
    assert.strictEqual(r.success, false);
  });

  test('permite reservar el slot contiguo libre (10:30)', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Cuarto', phone: '677777777',
      service: 'corte', date: nextMonday, time: '10:30',
    });
    assert.strictEqual(r.success, true, JSON.stringify(r));
  });

  test('rechaza fecha en el pasado', () => {
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Viajero del Tiempo', phone: '600000001',
      service: 'corte', date: ayer, time: '10:00',
    });
    assert.strictEqual(r.success, false);
  });

  test('rechaza fecha inexistente (2026-13-45)', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Fantasma', phone: '600000002',
      service: 'corte', date: '2026-13-45', time: '10:00',
    });
    assert.strictEqual(r.success, false);
  });

  test('rechaza formato de fecha inválido ("mañana")', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Vago', phone: '600000003',
      service: 'corte', date: 'mañana', time: '10:00',
    });
    assert.strictEqual(r.success, false);
  });

  test('rechaza hora fuera del horario de apertura (03:00)', () => {
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Noctámbulo', phone: '600000004',
      service: 'corte', date: nextMonday, time: '03:00',
    });
    assert.strictEqual(r.success, false);
    assert.match(r.error || '', /horario/i);
  });

  test('rechaza día cerrado (domingo)', () => {
    const sunday = (() => {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
      return d.toLocaleDateString('sv-SE');
    })();
    const r = scheduler.bookAppointment(BIZ, {
      patientName: 'Dominguero', phone: '600000005',
      service: 'corte', date: sunday, time: '10:00',
    });
    assert.strictEqual(r.success, false);
  });

  test('getAvailableSlots nunca devuelve slots en el pasado', () => {
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
    const hoy  = new Date().toLocaleDateString('sv-SE');
    const r = scheduler.getAvailableSlots(BIZ, ayer, hoy, 'corte');
    for (const day of r.availableDays || []) {
      assert.ok(day.date >= hoy, `slot en el pasado: ${day.date}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Rate limiter — ventana por IP
// ═════════════════════════════════════════════════════════════════════════════

describe('rate-limiter', () => {
  const { rateLimit } = require('../src/utils/rate-limiter');

  test('permite hasta max y bloquea la siguiente con 429', () => {
    const mw = rateLimit({ max: 3, windowMs: 60_000, keyPrefix: 'test-' + Date.now() });
    let passed = 0;

    for (let i = 0; i < 5; i++) {
      const { req, res } = mockReqRes({ ip: '10.0.0.1' });
      let called = false;
      mw(req, res, () => { called = true; });
      if (called) passed++;
      else assert.strictEqual(res.statusCode, 429);
    }
    assert.strictEqual(passed, 3);
  });

  test('IPs distintas tienen contadores independientes', () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000, keyPrefix: 'test-ips-' + Date.now() });
    const a = mockReqRes({ ip: '10.0.0.2' });
    const b = mockReqRes({ ip: '10.0.0.3' });
    let aOk = false, bOk = false;
    mw(a.req, a.res, () => { aOk = true; });
    mw(b.req, b.res, () => { bOk = true; });
    assert.ok(aOk && bOk);
  });

  test('req.isAdmin salta el límite', () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000, keyPrefix: 'test-admin-' + Date.now() });
    for (let i = 0; i < 10; i++) {
      const { req, res } = mockReqRes({ ip: '10.0.0.4' });
      req.isAdmin = true;
      let called = false;
      mw(req, res, () => { called = true; });
      assert.ok(called, 'admin bloqueado en iteración ' + i);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. WhatsApp reply-handler — normalización de teléfonos
//    (decide qué cita se confirma/cancela: si falla, se toca la cita equivocada)
// ═════════════════════════════════════════════════════════════════════════════

describe('whatsapp: normalizePhone', () => {
  const { normalizePhone } = require('../src/whatsapp/reply-handler');

  test('todas las variantes del mismo número producen el mismo resultado', () => {
    const variants = [
      '612345678',
      '34612345678',
      '+34612345678',
      '+34 612 345 678',
      '0034612345678',
      '612-345-678',
      '(612) 345 678',
    ];
    for (const v of variants) {
      assert.strictEqual(normalizePhone(v), '612345678', `variante: "${v}"`);
    }
  });

  test('no confunde números distintos', () => {
    assert.notStrictEqual(normalizePhone('612345678'), normalizePhone('612345679'));
  });

  test('entrada vacía o nula no explota', () => {
    assert.strictEqual(normalizePhone(''), '');
    assert.strictEqual(normalizePhone(), '');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Informe semanal — rango de fechas y render del email
// ═════════════════════════════════════════════════════════════════════════════

describe('weekly-report', () => {
  const { lastWeekRange } = require('../src/reports/weekly-report');

  test('el rango cubre exactamente 7 días y termina ayer', () => {
    const { from, to } = lastWeekRange();
    assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
    const days = (new Date(to) - new Date(from)) / 86400000;
    assert.strictEqual(days, 6); // from..to inclusive = 7 días
    const hoy = new Date().toLocaleDateString('sv-SE');
    assert.ok(to < hoy, 'el rango debe terminar antes de hoy');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Error tracker — middleware de Express
// ═════════════════════════════════════════════════════════════════════════════

describe('error-tracker', () => {
  const { expressErrorHandler } = require('../src/monitoring/error-tracker');

  test('el middleware de Express devuelve 500 con JSON limpio', () => {
    const mw = expressErrorHandler();
    const req = { method: 'GET', originalUrl: '/api/x', ip: '1.2.3.4' };
    const res = {
      statusCode: 200, headersSent: false, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    mw(new Error('boom'), req, res, () => {});
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error, 'Error interno del servidor');
  });

  test('respeta el status del error si lo trae', () => {
    const mw = expressErrorHandler();
    const req = { method: 'POST', url: '/y', ip: '1.1.1.1' };
    const res = {
      statusCode: 200, headersSent: false, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    const err = new Error('no auth'); err.status = 403;
    mw(err, req, res, () => {});
    assert.strictEqual(res.statusCode, 403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Auth middleware — resolveApiKey (sin query param tras el fix de seguridad)
// ═════════════════════════════════════════════════════════════════════════════

describe('auth middleware: resolveApiKey', () => {
  const { resolveApiKey } = require('../src/auth/middleware');

  test('lee x-api-key del header', () => {
    const req = { headers: { 'x-api-key': 'k1' }, query: {} };
    assert.strictEqual(resolveApiKey(req), 'k1');
  });

  test('lee Authorization Bearer', () => {
    const req = { headers: { authorization: 'Bearer k2' }, query: {} };
    assert.strictEqual(resolveApiKey(req), 'k2');
  });

  test('NO acepta API key por query param (fix de seguridad 2026-06-10)', () => {
    const req = { headers: {}, query: { apiKey: 'leaked-key' } };
    assert.strictEqual(resolveApiKey(req), null);
  });
});
