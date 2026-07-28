// ============================================================
// NodeFlow — Voz saliente Fase 2: tipos reseña + NPS (2026-07-28)
// Bloques de propósito (qué dice el asistente) + validación de teléfono de
// los encoladores. La rama con BD (bajas/encolado) la cubre el patrón común.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { PURPOSE_BLOCKS } = require('../src/telephony/outbound');
const { enqueueReviewCall, enqueueNpsCall } = require('../src/campaigns/enqueuers');

describe('PURPOSE_BLOCKS.review — pedir reseña', () => {
  test('menciona negocio, cliente, servicio y la reseña', () => {
    const b = PURPOSE_BLOCKS.review('Clínica Norte', 'Ana', 'limpieza');
    assert.match(b, /Clínica Norte/);
    assert.match(b, /Ana/);
    assert.match(b, /limpieza/);
    assert.match(b, /rese[ñn]a/i);
  });
  test('maneja el caso de cliente descontento (no pide reseña si algo fue mal)', () => {
    const b = PURPOSE_BLOCKS.review('X', 'Ana');
    assert.match(b, /NO fue bien/);
    assert.match(b, /NUNCA/);
  });
  test('sin nombre no rompe', () => {
    assert.match(PURPOSE_BLOCKS.review('X'), /un cliente/);
  });
});

describe('PURPOSE_BLOCKS.nps — encuesta 0-10', () => {
  test('pide la nota 0 al 10 y el porqué', () => {
    const b = PURPOSE_BLOCKS.nps('Clínica Norte', 'Ana');
    assert.match(b, /0 al 10/);
    assert.match(b, /Clínica Norte/);
    assert.match(b, /porqu[eé]/i);
  });
  test('no vende ni insiste', () => {
    const b = PURPOSE_BLOCKS.nps('X');
    assert.match(b, /NO vendas/);
  });
});

describe('enqueueReviewCall / enqueueNpsCall — validación de teléfono', () => {
  test('teléfono inválido → no encola (sin tocar BD)', async () => {
    assert.deepStrictEqual(await enqueueReviewCall('o1', 'Neg', { phone: '123' }), { queued: false, reason: 'phone_invalid' });
    assert.deepStrictEqual(await enqueueNpsCall('o1', 'Neg', { phone: '' }), { queued: false, reason: 'phone_invalid' });
    assert.deepStrictEqual(await enqueueReviewCall('o1', 'Neg', {}), { queued: false, reason: 'phone_invalid' });
    assert.deepStrictEqual(await enqueueNpsCall('o1', 'Neg', null), { queued: false, reason: 'phone_invalid' });
  });
});
