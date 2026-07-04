// ============================================================
// NodeFlow — Add-ons de suscripción (gating +10€ voz Premium /
// Crecimiento 39€). Charter: el candado es server-side y
// determinista — elegir una voz premium sin el add-on se rechaza
// en el PUT, no depende de que el UI se porte bien. Sin castigo
// retroactivo: la voz premium YA guardada sigue sonando; el candado
// solo bloquea CAMBIAR a premium sin pagar.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  ADDONS, hasAddon, listAddons, voiceChangeAllowed, activateAddon, cancelAddon,
} = require('../src/billing/addons');

const RESOLVE = (id) => ({
  'premium-1':  { provider: 'elevenlabs', providerVoiceId: 'x', tier: 'premium' },
  'estandar-1': { provider: 'azure', providerVoiceId: 'y', tier: 'estandar' },
}[id] || null);

function org(addons, currentVoice) {
  return {
    assistant_config: { voice: currentVoice || '' },
    automation_config: { config: { addons: addons || {} } },
  };
}

describe('hasAddon / listAddons', () => {
  test('addon activo se detecta; sin addons, todo false', () => {
    assert.strictEqual(hasAddon(org({ voice_premium: { itemId: 'si_1' } }), 'voice_premium'), true);
    assert.strictEqual(hasAddon(org({}), 'voice_premium'), false);
    assert.strictEqual(hasAddon(null, 'voice_premium'), false);
  });

  test('listAddons devuelve estado + disponibilidad (env del price)', () => {
    process.env.STRIPE_ADDON_VOICE_PRICE_ID = 'price_test_voice';
    delete process.env.STRIPE_ADDON_GROWTH_PRICE_ID;
    const out = listAddons(org({ voice_premium: { itemId: 'si_1' } }));
    const voice = out.find(a => a.key === 'voice_premium');
    const growth = out.find(a => a.key === 'growth');
    assert.strictEqual(voice.active, true);
    assert.strictEqual(voice.available, true);
    assert.strictEqual(voice.monthlyCents, 1000);
    assert.strictEqual(growth.active, false);
    assert.strictEqual(growth.available, false);
    assert.strictEqual(growth.monthlyCents, 3900);
  });
});

describe('voiceChangeAllowed — el candado de la voz premium', () => {
  test('voz estándar siempre pasa; voz desconocida/legacy pasa', () => {
    assert.strictEqual(voiceChangeAllowed(org({}), 'estandar-1', { resolve: RESOLVE }).allowed, true);
    assert.strictEqual(voiceChangeAllowed(org({}), 'nova-legacy', { resolve: RESOLVE }).allowed, true);
    assert.strictEqual(voiceChangeAllowed(org({}), '', { resolve: RESOLVE }).allowed, true);
  });

  test('cambiar a premium SIN addon → bloqueado con mensaje accionable', () => {
    const check = voiceChangeAllowed(org({}), 'premium-1', { resolve: RESOLVE });
    assert.strictEqual(check.allowed, false);
    assert.match(check.reason, /Premium.*10.*Facturación/is);
  });

  test('cambiar a premium CON addon → pasa', () => {
    assert.strictEqual(
      voiceChangeAllowed(org({ voice_premium: { itemId: 'si_1' } }), 'premium-1', { resolve: RESOLVE }).allowed,
      true
    );
  });

  test('sin castigo retroactivo: mantener la MISMA voz premium ya guardada pasa', () => {
    assert.strictEqual(
      voiceChangeAllowed(org({}, 'premium-1'), 'premium-1', { resolve: RESOLVE }).allowed,
      true
    );
  });
});

describe('activateAddon / cancelAddon — subscription items de Stripe', () => {
  function fakeDeps(orgRow, itemResult) {
    const calls = { created: null, deleted: null, dbUpdate: null };
    return {
      calls,
      billing: {
        enabled: true,
        stripe: {
          subscriptionItems: {
            create: async (args) => { calls.created = args; return itemResult || { id: 'si_new' }; },
            del: async (id, args) => { calls.deleted = { id, args }; return { deleted: true }; },
          },
        },
      },
      db: {
        enabled: true,
        client: {
          from: () => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: orgRow }) }) }),
            update: (patch) => { calls.dbUpdate = patch; return { eq: async () => ({ error: null }) }; },
          }),
        },
      },
    };
  }

  // Factoría: cada test recibe su propia fila (activateAddon persiste sobre
  // el objeto org y un ORG_ROW compartido contaminaba los tests siguientes)
  const ORG_ROW = () => ({
    id: 'org-1', stripe_subscription_id: 'sub_123',
    automation_config: { config: { addons: {} } },
  });

  test('activa: crea el item con el price del env y persiste el flag', async () => {
    process.env.STRIPE_ADDON_VOICE_PRICE_ID = 'price_test_voice';
    const deps = fakeDeps(ORG_ROW());
    const out = await activateAddon('org-1', 'voice_premium', deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(deps.calls.created.subscription, 'sub_123');
    assert.strictEqual(deps.calls.created.price, 'price_test_voice');
    assert.strictEqual(deps.calls.dbUpdate.automation_config.config.addons.voice_premium.itemId, 'si_new');
  });

  test('sin suscripción activa → error honesto, sin tocar Stripe', async () => {
    const deps = fakeDeps({ ...ORG_ROW(), stripe_subscription_id: null });
    const out = await activateAddon('org-1', 'voice_premium', deps);
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /plan/i);
    assert.strictEqual(deps.calls.created, null);
  });

  test('sin price configurado en env → error honesto', async () => {
    delete process.env.STRIPE_ADDON_GROWTH_PRICE_ID;
    const out = await activateAddon('org-1', 'growth', fakeDeps(ORG_ROW()));
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /disponible|configurado/i);
  });

  test('ya activo → idempotente, no duplica el item', async () => {
    const deps = fakeDeps({ ...ORG_ROW(), automation_config: { config: { addons: { voice_premium: { itemId: 'si_old' } } } } });
    const out = await activateAddon('org-1', 'voice_premium', deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.already, true);
    assert.strictEqual(deps.calls.created, null);
  });

  test('cancela: borra el item y limpia el flag', async () => {
    const deps = fakeDeps({ ...ORG_ROW(), automation_config: { config: { addons: { voice_premium: { itemId: 'si_old' } } } } });
    const out = await cancelAddon('org-1', 'voice_premium', deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(deps.calls.deleted.id, 'si_old');
    assert.strictEqual(deps.calls.dbUpdate.automation_config.config.addons.voice_premium, undefined);
  });

  test('addon desconocido → error sin lanzar', async () => {
    const out = await activateAddon('org-1', 'no-existe', fakeDeps(ORG_ROW()));
    assert.strictEqual(out.ok, false);
  });
});
