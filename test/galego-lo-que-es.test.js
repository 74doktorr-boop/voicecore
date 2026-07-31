'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL GALEGO: SE ATIENDE, PERO LA VOZ NO ES GALLEGA
//
// Al quitar ElevenLabs se fue con ella `brais-gl`, la ÚNICA voz gallega del
// catálogo. Y el «servidor propio de síntesis para galego» que prometía la
// política de privacidad existe como hueco vacío: el proveedor `local-gl` está
// registrado con el comentario «Will be updated when GL voices are cloned».
//
// QUÉ PASA HOY, medido contra la API de Cartesia:
//   · el asistente entiende y responde en galego — el texto está bien;
//   · lo lee una VOZ CASTELLANA (comprobado sintetizando «Bo día, chamou a
//     Hierros A Freixa»: 34.781 bytes de audio correcto);
//   · no hay acento gallego.
//
// La web prometía «acento galego real», «entoación da nosa terra», «non é texto
// a voz robótica» y «voces propias en galego». Lo contrario de lo que ocurre, y
// con un agravante sobre el euskera: aquí hay un CLIENTE REAL en es+gl.
//
// Lo que se retira es la promesa de la VOZ, no la del idioma. Atender en galego
// sigue siendo cierto y sigue siendo un argumento.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'hementxe' && e.name !== 'admin') paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');
const texto = (h) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
                      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('ninguna página promete voz o acento gallego', () => {
  // El `(?<!non ten )` no es un capricho: la frase honesta que sustituye a la
  // falsa dice «non ten acento galego». Sin la excepción, el test denunciaría
  // justamente el arreglo — y un chivato que señala la solución se acaba
  // ignorando.
  const RE = /galego nativo|gallego nativo|(?<!non ten )acento galego|acento gallego|voces propias en galego|entoación da nosa terra|suenan a galego de verdad/gi;
  const hits = [];
  for (const f of paginas()) {
    const t = texto(fs.readFileSync(f, 'utf8'));
    for (const m of t.matchAll(RE)) hits.push(`${rel(f)}: «…${t.slice(Math.max(0, m.index - 30), m.index + 55).trim()}…»`);
  }
  assert.deepEqual(hits, [],
    'No hay voz gallega: brais-gl era de ElevenLabs y se fue con la clave. Lo ' +
    `que suena es una voz castellana leyendo texto en galego:\n  ${hits.join('\n  ')}`);
});

test('la privacidad no promete un servidor de voz gallega que no sirve nada', () => {
  const hits = paginas()
    .filter(f => /servidor propio de síntesis de voz para galego/i.test(texto(fs.readFileSync(f, 'utf8'))))
    .map(rel);
  assert.deepEqual(hits, [],
    'La política de privacidad vuelve a prometer infraestructura propia para ' +
    `galego. El proveedor local-gl no tiene ninguna voz clonada:\n  ${hits.join('\n  ')}`);
});

test('lo que SÍ es cierto se conserva: atiende en galego', () => {
  // La otra dirección. Retirar la promesa de la voz no puede llevarse por
  // delante el idioma, que es verdad y es el motivo de que exista /galiza.
  const f = path.join(PUBLIC, 'galiza', 'index.html');
  if (!fs.existsSync(f)) return;
  const t = texto(fs.readFileSync(f, 'utf8'));
  assert.match(t, /[Aa]tende .{0,30}en galego/,
    'La landing gallega ha perdido la afirmación de que atiende en galego, que ' +
    'sigue siendo cierta y es la razón de que esa página exista.');
});

test('el código de idioma se normaliza antes de mandarlo al proveedor', () => {
  // Medido: Cartesia acepta `language:'es'` pero devuelve «400 Invalid
  // language» con 'es+gl' y con 'gl'. Sin normalizar, al único cliente gallego
  // le fallaba Cartesia SIEMPRE por el código —no por la voz— y la llamada
  // acababa en el proveedor de reserva, un 33% más caro.
  const { TTSRouter } = require('../src/tts/router');
  const r = new TTSRouter({ cartesiaApiKey: 'x', openaiApiKey: 'x' });
  assert.equal(r._buildParams('cartesia', null, 1, 'es+gl').language, 'es',
    'Cartesia vuelve a recibir un código de idioma que rechaza con un 400');
  assert.equal(r._buildParams('cartesia', null, 1, 'es').language, 'es');
});
