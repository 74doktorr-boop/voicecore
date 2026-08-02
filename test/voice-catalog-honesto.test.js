// ============================================================
// NodeFlow — El catálogo de voces es HONESTO
// Bug real (2026-07-03, reportado 3 veces por Unai): el catálogo
// pintaba variedad (voces "de Google", "Cartesia"...) pero todo
// colapsaba a 4 IDs reales de ElevenLabs — el cliente oía la misma
// voz con distinto nombre. Estos tests hacen imposible la regresión:
// cada voz del catálogo debe resolver a un voice_id REAL y ÚNICO.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveElevenVoice } = require('../src/tts/voice-map');

const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'voices.json'), 'utf8')
);

const castellano = catalog.voices.filter(v => v.language === 'es-ES' && !v.isClone);

describe('catálogo de voces honesto', () => {
  test('cada voz castellana tiene un providerVoiceId ÚNICO (nada de repetidas)', () => {
    const ids = castellano.map(v => v.providerVoiceId);
    const unicos = new Set(ids);
    assert.strictEqual(unicos.size, ids.length,
      `hay voces compartiendo ID real: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  });

  // voice-map solo traduce voces de ElevenLabs; las de Cartesia/local van por
  // resolveVoiceEntry (proveedor propio) — se testean más abajo.
  const eleven = castellano.filter(v => v.provider === 'elevenlabs');

  test('el traductor voice-map también resuelve cada id ElevenLabs a un ID único', () => {
    const resueltos = eleven.map(v => resolveElevenVoice(v.id));
    const unicos = new Set(resueltos);
    assert.strictEqual(unicos.size, resueltos.length,
      'voice-map colapsa varias voces del catálogo al mismo ID real');
  });

  test('catálogo y voice-map están alineados (mismo ID real por voz ElevenLabs)', () => {
    for (const v of eleven) {
      assert.strictEqual(resolveElevenVoice(v.id), v.providerVoiceId,
        `${v.id}: catálogo dice ${v.providerVoiceId} pero voice-map resuelve ${resolveElevenVoice(v.id)}`);
    }
  });

  test('ningún proveedor fantasma: es-ES es elevenlabs/cartesia, con IDs con pinta real', () => {
    for (const v of castellano) {
      assert.ok(['elevenlabs', 'cartesia'].includes(v.provider), `${v.id} declara proveedor "${v.provider}"`);
      if (v.provider === 'elevenlabs') {
        assert.match(v.providerVoiceId, /^[A-Za-z0-9]{20}$/, `${v.id}: providerVoiceId no parece un ID real de ElevenLabs`);
      } else {
        assert.match(v.providerVoiceId, /^[0-9a-f-]{36}$/, `${v.id}: providerVoiceId no parece un UUID de Cartesia`);
      }
    }
  });

  test('tiers (Unai 2026-07-04, "las dos cosas"): solo Estándar (incluida) y Premium', () => {
    const { getTiers } = require('../src/tts/voice-catalog');
    const tiers = getTiers();
    for (const v of catalog.voices) assert.ok(v.tier, `${v.id} sin tier`);
    // El tier "ultra" se disolvió: Cartesia pasó a ser INCLUIDO, no un upsell.
    // Y el 2026-08-01 se retiró también "premium" (decisión de Unai): sus 13
    // voces eran todas de ElevenLabs y al quitar la clave se quedó sin ninguna.
    // El bloque `tiers` es el INTERRUPTOR — volver a ponerlo las devuelve.
    assert.deepStrictEqual(Object.keys(tiers).sort(), ['estandar']);
    assert.strictEqual(tiers.ultra, undefined, 'el tier ultra ya no existe');
    assert.strictEqual(tiers.premium, undefined, 'el nivel premium se retiró: no hay voces que darle');
    assert.strictEqual(tiers.estandar.monthlyExtra, 0);
    // Antes esto solo pedía «> 0», y con eso pasaba cualquier número. Pasó:
    // el tier decía minutesIncluded 300, el blurb decía «500 min/mes» y el plan
    // real daba 200 (se bajó de 500 a 200 el 29/07 y aquí no se enteró nadie).
    // Tres cifras distintas para lo mismo, en el fichero que describe lo que se
    // vende. Ahora se compara contra la FUENTE, que es PLAN_LIMITS: si mañana
    // se vuelve a mover el cupo, esto se pone rojo en vez de callarse.
    const { PLAN_LIMITS } = require('../src/auth/middleware');
    const { StripeBilling } = require('../src/billing/stripe');
    const planStripe = new StripeBilling({}).plans.negocio;
    assert.strictEqual(tiers.estandar.minutesIncluded, PLAN_LIMITS.negocio.minutesPerMonth,
      'los minutos del tier incluido no son los del plan');
    assert.strictEqual(tiers.estandar.overagePerMin, planStripe.overagePerMinute,
      'el precio del minuto extra no es el que cobra Stripe');
    // Y las cifras NO se repiten dentro del texto: un número escrito a mano en
    // una frase es el que nadie actualiza. Que lo pinte quien lo sabe.
    for (const [k, v] of Object.entries(tiers)) {
      assert.ok(!/\d+\s*min\b/i.test(v.blurb || ''),
        `el blurb de "${k}" vuelve a llevar los minutos escritos a mano: «${v.blurb}»`);
    }
    // El tier incluido lo respalda Cartesia (rápido, barato). Azure eliminado 2026-07-04.
    const incluidas = catalog.voices.filter(v => v.tier === 'estandar');
    const provsIncluidos = new Set(incluidas.map(v => v.provider));
    assert.ok(provsIncluidos.has('cartesia'), 'Cartesia debe estar en el tier incluido');
    const cartesia = catalog.voices.filter(v => v.provider === 'cartesia');
    assert.ok(cartesia.length >= 6, 'las 6 voces curadas de Cartesia');
    assert.ok(cartesia.every(v => v.tier === 'estandar'), 'toda Cartesia es incluida ahora');
    // Ninguna voz debe quedar en el tier fantasma
    assert.ok(catalog.voices.every(v => v.tier === 'estandar' || v.tier === 'premium'));
  });

  describe('renderableVoices — el catálogo solo ofrece voces cuyo proveedor está ACTIVO', () => {
    const { renderableVoices } = require('../src/tts/voice-catalog');
    const sample = [
      { id: 'a', provider: 'google' }, { id: 'b', provider: 'cartesia' },
      { id: 'c', provider: 'elevenlabs' }, { id: 'd', provider: 'local' },
    ];
    test('un proveedor sin key NO se ofrece (evita el colapso a una sola voz)', () => {
      const out = renderableVoices(sample, new Set(['cartesia', 'elevenlabs', 'local']));
      assert.deepStrictEqual(out.map(v => v.id), ['b', 'c', 'd']);
    });
    test('con el proveedor activo, reaparece', () => {
      const out = renderableVoices(sample, new Set(['google', 'cartesia', 'elevenlabs', 'local']));
      assert.deepStrictEqual(out.map(v => v.id), ['a', 'b', 'c', 'd']);
    });
    test('fail-open: sin info de proveedores no oculta nada (no dejar el selector vacío por un bug de wiring)', () => {
      assert.strictEqual(renderableVoices(sample, new Set()).length, 4);
      assert.strictEqual(renderableVoices(sample).length, 4);
    });

    // ── El otro sentido del filtro, añadido al retirar Premium (01/08) ────────
    // Sin esto, el bloque `tiers` de voices.json no sería un interruptor de
    // verdad: bastaría con que alguien volviera a poner una clave de ElevenLabs
    // para que las 13 voces premium reaparecieran en el selector de un nivel que
    // ya no se vende — y al elegir una saltaría el candado de voiceChangeAllowed.
    // Un selector que ofrece cosas que rechaza al pulsarlas es peor que uno corto.
    const porNivel = [
      { id: 'e1', provider: 'cartesia', tier: 'estandar' },
      { id: 'p1', provider: 'elevenlabs', tier: 'premium' },
      { id: 'sn', provider: 'cartesia' },   // sin tier → cuenta como premium
    ];
    const TODOS = new Set(['cartesia', 'elevenlabs']);

    test('una voz de un nivel que NO se ofrece no se enseña', () => {
      const out = renderableVoices(porNivel, TODOS, { estandar: {} });
      assert.deepStrictEqual(out.map(v => v.id), ['e1']);
    });

    test('si el nivel vuelve a ofrecerse, sus voces vuelven solas', () => {
      const out = renderableVoices(porNivel, TODOS, { estandar: {}, premium: {} });
      assert.deepStrictEqual(out.map(v => v.id), ['e1', 'p1', 'sn']);
    });

    test('fail-open también aquí: sin info de niveles no se oculta nada', () => {
      assert.strictEqual(renderableVoices(porNivel, TODOS).length, 3);
      assert.strictEqual(renderableVoices(porNivel, TODOS, {}).length, 3);
      assert.strictEqual(renderableVoices(porNivel, TODOS, null).length, 3);
    });

    test('los dos filtros se aplican a la vez, no uno u otro', () => {
      // Proveedor activo Y nivel ofrecido. Que pasen los dos por separado no
      // demuestra que se apliquen juntos.
      const out = renderableVoices(porNivel, new Set(['elevenlabs']), { estandar: {}, premium: {} });
      assert.deepStrictEqual(out.map(v => v.id), ['p1']);
    });
  });

  test('EL INTERRUPTOR: con el catálogo REAL no se ofrece ninguna voz premium', () => {
    // La comprobación de punta a punta, con el fichero de verdad y no con
    // muestras: hoy `tiers` solo declara "estandar", así que aunque el proveedor
    // ElevenLabs estuviera activo, sus 13 voces no pueden salir.
    const { renderableVoices, getTiers, staticCatalog, offerableTiers } = require('../src/tts/voice-catalog');
    const todosLosProveedores = new Set(['cartesia', 'elevenlabs', 'local']);
    const ofrecidas = renderableVoices(staticCatalog(), todosLosProveedores, getTiers());
    assert.ok(ofrecidas.length > 0, 'se ha quedado el selector vacío');
    assert.ok(ofrecidas.every(v => v.tier === 'estandar'),
      'vuelve a ofrecerse alguna voz de un nivel retirado: ' +
      ofrecidas.filter(v => v.tier !== 'estandar').map(v => `${v.id}(${v.tier})`).join(', '));
    assert.deepStrictEqual(Object.keys(offerableTiers(getTiers(), ofrecidas)), ['estandar']);
  });

  describe('offerableTiers — no se anuncia un nivel que no tiene voces dentro', () => {
    const { offerableTiers } = require('../src/tts/voice-catalog');
    const TIERS = { estandar: { label: 'Estándar' }, premium: { label: 'Premium', monthlyExtra: 10 } };

    test('sin voces premium, el nivel Premium no sale (es lo que pasa HOY)', () => {
      // Las 13 voces premium eran todas de ElevenLabs. Al quitar su clave —cuenta
      // en plan gratuito, 402 desde siempre, nunca sintetizó nada— se fueron las
      // 13 a la vez y quedaron 6 voces, todas estándar. El apartado con el
      // «+10€/mes» escrito no puede seguir anunciándose sin nada detrás.
      const soloEstandar = [{ id: 'a', tier: 'estandar' }, { id: 'b', tier: 'estandar' }];
      assert.deepStrictEqual(Object.keys(offerableTiers(TIERS, soloEstandar)), ['estandar']);
    });

    test('en cuanto haya UNA voz premium que suene, el nivel vuelve solo', () => {
      // Esto es lo que separa un invariante de un apaño: no se tacha «premium» a
      // mano, se ata a que exista voz. El día que haya una premium de verdad
      // —otro proveedor, o ElevenLabs de pago— el apartado reaparece sin que
      // nadie tenga que acordarse de destacharlo. Nadie se acuerda nunca.
      const conPremium = [{ id: 'a', tier: 'estandar' }, { id: 'c', tier: 'premium' }];
      assert.deepStrictEqual(Object.keys(offerableTiers(TIERS, conPremium)).sort(), ['estandar', 'premium']);
    });

    test('sin voces no se anuncia ningún nivel', () => {
      assert.deepStrictEqual(offerableTiers(TIERS, []), {});
    });

    test('una voz sin tier cuenta como premium (igual que en el resto del catálogo)', () => {
      // staticCatalog() y resolveVoiceEntry() ya tratan la ausencia de tier como
      // 'premium'. Si aquí se tratara como 'estandar', una voz sin etiquetar
      // haría aparecer el nivel equivocado.
      assert.deepStrictEqual(Object.keys(offerableTiers(TIERS, [{ id: 'x' }])), ['premium']);
    });

    test('aguanta entradas rotas sin dejar el selector sin niveles', () => {
      assert.deepStrictEqual(offerableTiers(null, [{ tier: 'estandar' }]), {});
      assert.deepStrictEqual(offerableTiers(TIERS, null), {});
    });
  });

  test('resolveVoiceEntry decide el proveedor por voz (Cartesia ↔ ElevenLabs ↔ local)', () => {
    const { resolveVoiceEntry } = require('../src/tts/voice-catalog');
    assert.deepStrictEqual(resolveVoiceEntry('blanca-ca'),
      { provider: 'cartesia', providerVoiceId: '538a8872-3799-4df5-b373-b78493b766c6', tier: 'estandar', gender: 'female', language: 'es' });
    assert.strictEqual(resolveVoiceEntry('cristina-es').provider, 'elevenlabs');
    assert.strictEqual(resolveVoiceEntry('ane-eu').provider, 'local');
    assert.strictEqual(resolveVoiceEntry('no-existe'), null);
  });

  test('la entrada trae el IDIOMA, y normalizado', () => {
    const { resolveVoiceEntry, staticCatalog } = require('../src/tts/voice-catalog');
    // No es un campo de adorno: la prueba de voz compara el idioma de la voz
    // con el del asistente, y es la ÚNICA comprobación que habría cazado a
    // «Greg», la voz inglesa que estuvo contestando el teléfono en castellano.
    // El fichero guarda 'es-ES' y el asistente guarda 'es', así que si no se
    // normaliza aquí la comparación falla siempre y la prueba grita en falso.
    assert.strictEqual(resolveVoiceEntry('marta-ca').language, 'es');
    assert.strictEqual(resolveVoiceEntry('ane-eu').language, 'eu');
    assert.strictEqual(resolveVoiceEntry('brais-gl').language, 'gl');
    for (const v of staticCatalog()) {
      assert.ok(resolveVoiceEntry(v.id).language,
        `la voz «${v.id}» no declara idioma: la prueba de voz no puede juzgarla`);
    }
  });

  test('los alias del catálogo antiguo siguen sonando (y distintos entre sí)', () => {
    const legacy = ['marta-studio', 'jorge-studio', 'carmen-journey', 'isabel-cartesia', 'andrea-11labs'];
    const resueltos = legacy.map(resolveElevenVoice);
    assert.strictEqual(new Set(resueltos).size, legacy.length);
  });

  test('hay variedad de verdad: al menos 10 voces castellanas distintas', () => {
    assert.ok(castellano.length >= 10, `solo ${castellano.length} voces castellanas`);
  });
});
