'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA VOZ POR DEFECTO DECIDE EL COSTE DE LA EMPRESA
//
// El proveedor de voz no se elige en ninguna configuración: lo decide la VOZ.
// Y la voz por defecto de un asistente nuevo era 'nova', que no existe en el
// catálogo — así que no resolvía a nada y la llamada caía por descarte en
// ElevenLabs. Resultado medido sobre llamadas reales: 30 con ElevenLabs
// (0,10 €/min), 0 con Cartesia (0,015), teniendo el tier "incluido" construido
// entero y sin usar.
//
// Lo que se fija aquí no es un nombre de voz: es que la voz por defecto tenga
// SIEMPRE entrada en el catálogo y sea del tier incluido. Un valor que no
// resuelve es lo que abrió el agujero, y no se ve mirando el código.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { VOZ_POR_DEFECTO, includedFallbackFor } = require('../src/tts/voice-quota');
const { resolveVoiceEntry } = require('../src/tts/voice-catalog');

test('la voz por defecto EXISTE en el catálogo', () => {
  const e = resolveVoiceEntry(VOZ_POR_DEFECTO);
  assert.ok(e, `"${VOZ_POR_DEFECTO}" no resuelve a ninguna voz del catálogo. ` +
    'Una voz que no resuelve no falla: cae por descarte en el proveedor caro, en silencio.');
  assert.ok(e.providerVoiceId, 'la voz resuelve pero sin id de proveedor');
});

test('la voz por defecto es del tier INCLUIDO, no del premium', () => {
  const e = resolveVoiceEntry(VOZ_POR_DEFECTO);
  assert.equal(e.tier, 'estandar',
    `La voz por defecto es "${e.tier}" (${e.provider}). El tier premium cuesta ` +
    '0,10 €/min frente a 0,015: ponerlo por defecto es regalar el margen a ' +
    'todo cliente que no toque la configuración, que son casi todos.');
  assert.equal(e.provider, 'cartesia');
});

test('la voz por defecto y la de respaldo por cupo son la MISMA', () => {
  // Si no coinciden, al agotarse el cupo premium el cliente nota un cambio de
  // timbre a mitad de mes sin haber tocado nada — y llama preguntando qué pasa.
  const respaldo = includedFallbackFor(resolveVoiceEntry(VOZ_POR_DEFECTO).gender);
  assert.equal(respaldo, VOZ_POR_DEFECTO,
    `Por defecto suena "${VOZ_POR_DEFECTO}" pero al degradar suena "${respaldo}".`);
});

test('ningún sitio del código vuelve a fijar una voz a mano', () => {
  // Estaba en SIETE ficheros distintos. Con el valor repetido, cambiarlo exige
  // acertar en los siete y basta olvidar uno para que un camino siga caro.
  const raiz = path.join(__dirname, '..', 'src');
  const sospechosos = [];
  (function rec(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { rec(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      // La telefonía heredada (twilio/vonage) queda fuera: son rutas muertas.
      if (/twilio|vonage/i.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (/voice:\s*(assistant|cfg|config|session\.assistant|registro)\.\w+\s*\|\|\s*['"]nova['"]/.test(s)) {
        sospechosos.push(path.relative(raiz, p));
      }
    }
  })(raiz);
  assert.deepEqual(sospechosos, [],
    'Estos ficheros vuelven a fijar la voz a mano en vez de usar VOZ_POR_DEFECTO: ' +
    sospechosos.join(', '));
});

test('se puede cambiar por entorno sin tocar código', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tts', 'voice-quota.js'), 'utf8');
  assert.match(src, /process\.env\.DEFAULT_VOICE_ID/,
    'Si en producción no convence cómo suena, tiene que arreglarse con una ' +
    'variable y un reinicio — no con un despliegue.');
});
