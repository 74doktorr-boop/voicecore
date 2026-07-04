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
    assert.deepStrictEqual(Object.keys(tiers).sort(), ['estandar', 'premium']);
    assert.strictEqual(tiers.ultra, undefined, 'el tier ultra ya no existe');
    assert.strictEqual(tiers.estandar.monthlyExtra, 0);
    assert.strictEqual(tiers.premium.monthlyExtra, 10);
    assert.ok(tiers.estandar.minutesIncluded > 0 && tiers.estandar.overagePerMin > 0);
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
  });

  test('resolveVoiceEntry decide el proveedor por voz (Cartesia ↔ ElevenLabs ↔ local)', () => {
    const { resolveVoiceEntry } = require('../src/tts/voice-catalog');
    assert.deepStrictEqual(resolveVoiceEntry('blanca-ca'),
      { provider: 'cartesia', providerVoiceId: '538a8872-3799-4df5-b373-b78493b766c6', tier: 'estandar', gender: 'female' });
    assert.strictEqual(resolveVoiceEntry('cristina-es').provider, 'elevenlabs');
    assert.strictEqual(resolveVoiceEntry('ane-eu').provider, 'local');
    assert.strictEqual(resolveVoiceEntry('no-existe'), null);
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
