// ============================================================
// NodeFlow — Packs de minutos de voz (compra puntual, 2026-07-04)
// El cliente amplía su cupo de voz Premium/Ultra comprando un pack
// (50 min ElevenLabs / 100 min Cartesia por 5€). Al pagar, Stripe
// dispara el webhook y sumamos los minutos a premiumExtraMinutes.
// CRÍTICO: idempotente por sessionId — Stripe reintenta webhooks y no
// debemos sumar el pack dos veces (es dinero del cliente).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { applyVoicePack, settleMonthlyPack, PACKS } = require('../src/billing/voice-packs');

function fakeDb(orgRow) {
  const saved = {};
  return {
    _saved: saved,
    enabled: true,
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: orgRow }) }) }),
        update: (patch) => { saved.patch = patch; return { eq: async () => ({ error: null }) }; },
      }),
    },
  };
}

describe('PACKS', () => {
  test('define premium (50) y ultra (100)', () => {
    assert.strictEqual(PACKS.premium.minutes, 50);
    assert.strictEqual(PACKS.ultra.minutes, 100);
  });
});

describe('applyVoicePack', () => {
  test('suma los minutos del pack a premiumExtraMinutes', async () => {
    const db = fakeDb({ id: 'o1', automation_config: { config: { premiumExtraMinutes: 10 } } });
    const out = await applyVoicePack('o1', { sessionId: 'cs_1', minutes: 50 }, { db });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(db._saved.patch.automation_config.config.premiumExtraMinutes, 60);
  });

  test('idempotente: el mismo sessionId no suma dos veces', async () => {
    const db = fakeDb({ id: 'o1', automation_config: { config: { premiumExtraMinutes: 60, _voicePackSessions: ['cs_1'] } } });
    const out = await applyVoicePack('o1', { sessionId: 'cs_1', minutes: 50 }, { db });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.already, true);
    assert.strictEqual(db._saved.patch, undefined, 'no debe reescribir');
  });

  test('registra el sessionId procesado para la próxima vez', async () => {
    const db = fakeDb({ id: 'o1', automation_config: { config: {} } });
    await applyVoicePack('o1', { sessionId: 'cs_2', minutes: 100 }, { db });
    assert.deepStrictEqual(db._saved.patch.automation_config.config._voicePackSessions, ['cs_2']);
    assert.strictEqual(db._saved.patch.automation_config.config.premiumExtraMinutes, 100);
  });

  test('db apagada o sin minutos → no lanza', async () => {
    assert.strictEqual((await applyVoicePack('o1', { sessionId: 's', minutes: 50 }, { db: { enabled: false } })).ok, false);
    assert.strictEqual((await applyVoicePack('o1', { sessionId: 's', minutes: 0 }, { db: fakeDb({}) })).ok, false);
  });
});

describe('settleMonthlyPack — cierre de mes: los packs se gastan, no caducan', () => {
  test('cupo base no agotado → el pack no se toca ni se reescribe', async () => {
    const db = fakeDb({ id: 'o1', monthly_minutes_used: 20, automation_config: { config: { premiumExtraMinutes: 50 } } });
    const out = await settleMonthlyPack({ id: 'o1', monthly_minutes_used: 20, automation_config: { config: { premiumExtraMinutes: 50 } } }, { db });
    assert.strictEqual(out.changed, false);
    assert.strictEqual(out.extraMinutes, 50);
    assert.strictEqual(db._saved.patch, undefined, 'sin cambio no debe escribir');
  });

  test('desbordó el base → descuenta solo lo del pack y persiste el resto', async () => {
    const db = fakeDb({});
    const org = { id: 'o1', monthly_minutes_used: 60, automation_config: { config: { premiumExtraMinutes: 50 } } };
    const out = await settleMonthlyPack(org, { db });        // base 40; 20 salieron del pack → 30
    assert.strictEqual(out.changed, true);
    assert.strictEqual(out.extraMinutes, 30);
    assert.strictEqual(db._saved.patch.automation_config.config.premiumExtraMinutes, 30);
  });

  test('con add-on el base es 200 (el pack aguanta más)', async () => {
    const db = fakeDb({});
    const org = { id: 'o1', monthly_minutes_used: 210, automation_config: { config: { premiumExtraMinutes: 50, addons: { voice_premium: { since: 'x' } } } } };
    const out = await settleMonthlyPack(org, { db });        // base 200; 10 del pack → 40
    assert.strictEqual(out.extraMinutes, 40);
  });

  test('sin pack o db apagada → no escribe', async () => {
    const db = fakeDb({});
    const out = await settleMonthlyPack({ id: 'o1', monthly_minutes_used: 99, automation_config: { config: {} } }, { db });
    assert.strictEqual(out.changed, false);
    assert.strictEqual(db._saved.patch, undefined);
    const off = await settleMonthlyPack({ id: 'o1', automation_config: { config: { premiumExtraMinutes: 50 } } }, { db: { enabled: false } });
    assert.strictEqual(off.changed, false);
  });
});
