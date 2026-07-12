// ============================================================
// NodeFlow — Tests de los encoladores (capa de producto)
// Bloques de propósito y franja de encolado anti no-show.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildNoShowBlock, isNoShowEnqueueWindow, enqueueRecoveryBatch } = require('../src/campaigns/enqueuers');

describe('buildNoShowBlock', () => {
  const apt = { id: 'APT-77', patientName: 'María', service: 'Corte', time: '10:30' };

  test('menciona negocio, cliente, hora y el id de la cita', () => {
    const block = buildNoShowBlock('Peluquería HHR', apt);
    assert.match(block, /Peluquería HHR/);
    assert.match(block, /María/);
    assert.match(block, /10:30/);
    assert.match(block, /APT-77/);
  });

  test('cubre los tres caminos: confirmar, cambiar, cancelar — y el buzón', () => {
    const block = buildNoShowBlock('X', apt);
    assert.match(block, /CONFIRMA/);
    assert.match(block, /check_availability/);
    assert.match(block, /cancel_appointment/);
    assert.match(block, /buz[oó]n/i);
  });

  test('sin nombre de cliente no rompe', () => {
    const block = buildNoShowBlock('X', { id: 'A1', time: '09:00' });
    assert.match(block, /un cliente/);
  });
});

describe('franja de encolado anti no-show (16-19h Madrid)', () => {
  // jul 2026 → CEST (UTC+2)
  const madrid = (hour) => new Date(Date.UTC(2026, 6, 7, hour - 2, 30, 0));

  test('17:30 → dentro', () => assert.strictEqual(isNoShowEnqueueWindow(madrid(17)), true));
  test('12:30 → fuera', () => assert.strictEqual(isNoShowEnqueueWindow(madrid(12)), false));
  test('19:30 → fuera', () => assert.strictEqual(isNoShowEnqueueWindow(madrid(19)), false));
});

describe('enqueueRecoveryBatch — anti-duplicado', () => {
  function deps(over = {}) {
    const enqueued = [];
    return {
      enqueued,
      d: {
        contactInfo: async () => ({ blocked: false, contactId: 'c1', name: 'Ana' }),
        enqueue: async (job) => { enqueued.push(job.phone); return 'job-' + enqueued.length; },
        alreadyQueued: async () => false,
        ...over,
      },
    };
  }

  test('teléfono SIN recuperación en curso → se encola', async () => {
    const { enqueued, d } = deps();
    const r = await enqueueRecoveryBatch('org1', 'Peluquería', ['+34600111222'], d);
    assert.strictEqual(r.queued, 1);
    assert.strictEqual(enqueued.length, 1);
  });

  test('teléfono que YA tiene recuperación en curso → se salta (no doble llamada)', async () => {
    const { enqueued, d } = deps({ alreadyQueued: async () => true });
    const r = await enqueueRecoveryBatch('org1', 'Peluquería', ['+34600111222'], d);
    assert.strictEqual(r.queued, 0);
    assert.strictEqual(r.skipped, 1);
    assert.strictEqual(enqueued.length, 0);
  });

  test('cliente de baja (do_not_contact) → se salta', async () => {
    const { enqueued, d } = deps({ contactInfo: async () => ({ blocked: true, contactId: 'c1', name: 'Ana' }) });
    const r = await enqueueRecoveryBatch('org1', 'Peluquería', ['+34600111222'], d);
    assert.strictEqual(r.queued, 0);
    assert.strictEqual(enqueued.length, 0);
  });
});
