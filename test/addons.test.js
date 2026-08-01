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
  'estandar-1': { provider: 'cartesia', providerVoiceId: 'y', tier: 'estandar' },
}[id] || null);

// Básico por defecto: estos tests prueban el candado "sin el add-on". Un Pro
// tendría todos los add-ons incluidos, así que el candado solo aplica a Básico.
function org(addons, currentVoice) {
  return {
    assistant_config: { voice: currentVoice || '' },
    automation_config: { config: { tier: 'basico', addons: addons || {} } },
  };
}

describe('hasAddon / listAddons', () => {
  test('addon activo se detecta; sin addons, todo false', () => {
    assert.strictEqual(hasAddon(org({ voice_premium: { itemId: 'si_1' } }), 'voice_premium'), true);
    assert.strictEqual(hasAddon(org({}), 'voice_premium'), false);
    assert.strictEqual(hasAddon(null, 'voice_premium'), false);
  });

  test('listAddons devuelve estado + disponibilidad (env del price)', () => {
    process.env.STRIPE_ADDON_WA_PRICE_ID = 'price_test_wa';
    delete process.env.STRIPE_ADDON_GROWTH_PRICE_ID;
    const out = listAddons(org({ wa_own_number: { itemId: 'si_1' } }));
    const wa = out.find(a => a.key === 'wa_own_number');
    const growth = out.find(a => a.key === 'growth');
    assert.strictEqual(wa.active, true);
    assert.strictEqual(wa.available, true);
    assert.strictEqual(wa.monthlyCents, 1500);
    assert.strictEqual(growth.active, false);
    assert.strictEqual(growth.available, false);
    assert.strictEqual(growth.monthlyCents, 3900);
  });

  test('wa_own_number (número propio +15€) está en el catálogo', () => {
    process.env.STRIPE_ADDON_WA_PRICE_ID = 'price_test_wa';
    const out = listAddons(org({ wa_own_number: { itemId: 'si_wa' } }));
    const wa = out.find(a => a.key === 'wa_own_number');
    assert.ok(wa, 'wa_own_number debe estar en el catálogo');
    assert.strictEqual(wa.monthlyCents, 1500);
    assert.strictEqual(wa.active, true);
    assert.strictEqual(wa.available, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LA VOZ PREMIUM SE RETIRÓ (2026-08-01, decisión de Unai)
//
// Las 13 voces premium eran todas de ElevenLabs; al quitar su clave el nivel se
// quedó vacío. El complemento seguía anunciado a 10 €/mes y, como no había price
// id en Stripe, el portal remataba con «Muy pronto online — escríbenos y lo
// activamos hoy». No había nada que activar.
//
// Estos tests son los que impiden que vuelva sin querer: si alguien configura
// una price id, o llama a la ruta a mano, tiene que seguir diciendo que no.
// ─────────────────────────────────────────────────────────────────────────────
describe('voz premium retirada', () => {
  const ORG_ROW = () => ({
    id: 'org-1', stripe_subscription_id: 'sub_123',
    automation_config: { config: { tier: 'basico', addons: {} } },
  });
  const deps = () => ({
    billing: { enabled: true, stripe: { subscriptionItems: { create: async () => { throw new Error('NO se debe tocar Stripe'); } } } },
    db: { enabled: true, client: { from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: ORG_ROW() }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }) } },
  });

  test('el complemento sigue declarado, con el motivo por escrito', () => {
    // Marcado, no borrado: el código tiene que conservar POR QUÉ se retiró.
    // Un borrado limpio deja la decisión solo en el mensaje de un commit.
    assert.ok(ADDONS.voice_premium, 'se ha borrado en vez de marcarse');
    assert.ok(ADDONS.voice_premium.retirado, 'falta el motivo de la retirada');
  });

  test('no aparece en la lista del portal', () => {
    const claves = listAddons(org({})).map(a => a.key);
    assert.ok(!claves.includes('voice_premium'), 'sigue ofreciéndose en Complementos');
    assert.ok(claves.includes('growth') && claves.includes('wa_own_number'),
      'se han llevado por delante los complementos que SÍ se venden');
  });

  test('tampoco aparece aunque la org ya lo tuviera activo', () => {
    const claves = listAddons(org({ voice_premium: { itemId: 'si_1' } })).map(a => a.key);
    assert.ok(!claves.includes('voice_premium'));
  });

  test('activarlo se rechaza AUNQUE haya price id configurada', async () => {
    // El caso que importa: retirarlo del portal no basta si la ruta sigue
    // cobrando. Cobrar por algo que no se puede entregar es el único error que
    // no se arregla después con un despliegue.
    process.env.STRIPE_ADDON_VOICE_PRICE_ID = 'price_que_no_deberia_usarse';
    const out = await activateAddon('org-1', 'voice_premium', deps());
    delete process.env.STRIPE_ADDON_VOICE_PRICE_ID;
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /no está disponible/i);
  });

  test('el plan Pro ya no promete voz premium entre sus ventajas', () => {
    // 85 €/mes no pueden llevar en la lista algo que no existe.
    assert.doesNotMatch(ADDONS.pro.blurb, /voz premium/i);
    assert.match(ADDONS.pro.blurb, /WhatsApp/i, 'se ha vaciado la lista entera de Pro');
  });

  test('hasAddon SIGUE funcionando: no se castiga a quien ya lo tuviera', () => {
    // Retirar la venta no es quitarle nada a nadie. Si una org lo tiene en su
    // config, el entitlement se sigue leyendo.
    assert.strictEqual(hasAddon(org({ voice_premium: { itemId: 'si_1' } }), 'voice_premium'), true);
  });
});

describe('voiceChangeAllowed — el candado de la voz premium', () => {
  test('voz estándar siempre pasa; voz desconocida/legacy pasa', () => {
    assert.strictEqual(voiceChangeAllowed(org({}), 'estandar-1', { resolve: RESOLVE }).allowed, true);
    assert.strictEqual(voiceChangeAllowed(org({}), 'nova-legacy', { resolve: RESOLVE }).allowed, true);
    assert.strictEqual(voiceChangeAllowed(org({}), '', { resolve: RESOLVE }).allowed, true);
  });

  test('cambiar a premium SIN addon → bloqueado, y el motivo no manda a ningún sitio inexistente', () => {
    const check = voiceChangeAllowed(org({}), 'premium-1', { resolve: RESOLVE });
    assert.strictEqual(check.allowed, false);
    // Con el complemento RETIRADO (01/08) el mensaje ya no puede decir «actívalo
    // en Facturación → Complementos»: ahí no hay nada que activar. Mandar a
    // alguien a una pantalla vacía es peor que un «no» claro.
    assert.doesNotMatch(check.reason, /Facturación|Complementos|10\s*€/i,
      'el motivo sigue mandando al cliente a activar algo que ya no existe');
    assert.match(check.reason, /no está disponible/i);
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
  // Básico: es el ÚNICO caso donde activar un add-on cobra de verdad. Un Pro
  // los tiene incluidos, así que activateAddon corta antes (includedInPro).
  const ORG_ROW = () => ({
    id: 'org-1', stripe_subscription_id: 'sub_123',
    automation_config: { config: { tier: 'basico', addons: {} } },
  });

  test('activa: crea el item con el price del env y persiste el flag', async () => {
    process.env.STRIPE_ADDON_WA_PRICE_ID = 'price_test_wa';
    const deps = fakeDeps(ORG_ROW());
    const out = await activateAddon('org-1', 'wa_own_number', deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(deps.calls.created.subscription, 'sub_123');
    assert.strictEqual(deps.calls.created.price, 'price_test_wa');
    assert.strictEqual(deps.calls.dbUpdate.automation_config.config.addons.wa_own_number.itemId, 'si_new');
  });

  test('sin suscripción activa → error honesto, sin tocar Stripe', async () => {
    const deps = fakeDeps({ ...ORG_ROW(), stripe_subscription_id: null });
    const out = await activateAddon('org-1', 'wa_own_number', deps);
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
    const deps = fakeDeps({ ...ORG_ROW(), automation_config: { config: { tier: 'basico', addons: { wa_own_number: { itemId: 'si_old' } } } } });
    const out = await activateAddon('org-1', 'wa_own_number', deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.already, true);
    assert.strictEqual(deps.calls.created, null);
  });

  test('cancela: borra el item y limpia el flag', async () => {
    const deps = fakeDeps({ ...ORG_ROW(), automation_config: { config: { addons: { wa_own_number: { itemId: 'si_old' } } } } });
    const out = await cancelAddon('org-1', 'wa_own_number', deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(deps.calls.deleted.id, 'si_old');
    assert.strictEqual(deps.calls.dbUpdate.automation_config.config.addons.wa_own_number, undefined);
  });

  test('addon desconocido → error sin lanzar', async () => {
    const out = await activateAddon('org-1', 'no-existe', fakeDeps(ORG_ROW()));
    assert.strictEqual(out.ok, false);
  });

  test('activar sincroniza también el flow EN MEMORIA (el cron de reactivación lo lee)', async () => {
    process.env.STRIPE_ADDON_WA_PRICE_ID = 'price_test_wa';
    const flow = { automations: { rebooking: { enabled: true }, config: {} } };
    const deps = fakeDeps(ORG_ROW());
    deps.flowManager = { get: (id) => (id === 'org-1' ? flow : null) };
    const out = await activateAddon('org-1', 'wa_own_number', deps);
    assert.strictEqual(out.ok, true);
    assert.ok(flow.automations.config.addons.wa_own_number, 'flow en memoria actualizado');
    // y el formato es EXACTAMENTE el que consulta el gate del rebooking-cron:
    assert.strictEqual(hasAddon({ automation_config: flow.automations }, 'wa_own_number'), true);
  });
});
