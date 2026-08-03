'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA MEDIDA DEJA DE DEPENDER DE QUE ALGUIEN SE ACUERDE
//
// El tope de insistencia y el reintento del turno vacío se validaron SIMULANDO
// sobre llamadas ya ocurridas. El número de verdad lo dan las llamadas nuevas, y
// hasta ahora eso requería ejecutar un script a mano. Eso no es una medida.
//
// Dos cosas se prueban aquí, y ninguna es el cálculo —ese ya está fijado en
// preguntas-repetidas.test.js—:
//
//   · que el endpoint público no filtra NI UNA FRASE de ninguna conversación;
//   · que con pocas llamadas dice que no se puede concluir, en vez de dar un
//     porcentaje al lado de la referencia y dejar que cada cual saque la
//     conclusión que le apetezca.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../src/monitoring/salud-conversacion');

/** Base falsa con N llamadas iguales, cada una con una repetición. */
function baseCon(n) {
  const transcript = [
    { role: 'assistant', content: 'Es gratuita. ¿Te gustaría agendar una cita?' },
    { role: 'user', content: '¿tenéis parking?' },
    { role: 'assistant', content: 'Sí. ¿Te gustaría fijar una cita?' },
    { role: 'user', content: 'mi nombre es Ramón Pérez y mi móvil el 600123456' },
    { role: 'assistant', content: '¿Le aviso a este número desde el que me llama?' },
  ];
  const filas = Array.from({ length: n }, () => ({ transcript, metrics: { rematesCallados: 1 } }));
  return {
    enabled: true,
    client: { from: () => ({ select: () => ({ gte: async () => ({ data: filas }) }) }) },
  };
}

test('con pocas llamadas AVISA de que no se puede comparar', async () => {
  const i = await S.informe({ db: baseCon(6) });
  assert.equal(i.comparable, false);
  assert.match(i.resumen, /MUESTRA INSUFICIENTE/);
  assert.match(i.resumen, /NO se puede comparar/);
});

test('con muestra suficiente, deja de avisar', async () => {
  const i = await S.informe({ db: baseCon(S.MINIMO_PARA_COMPARAR) });
  assert.equal(i.comparable, true);
  assert.doesNotMatch(i.resumen, /INSUFICIENTE/);
});

test('EL ENDPOINT NO PUBLICA NI UNA FRASE DE NINGUNA CONVERSACIÓN', async () => {
  // La regla de ayer, aplicada al instrumento de hoy. Estos endpoints son
  // públicos a propósito —hay que poder mirarlos desde fuera— y por eso mismo
  // no pueden llevar dentro nada de nadie.
  const i = await S.informe({ db: baseCon(30) });
  const texto = JSON.stringify(i);
  for (const fuga of ['parking', 'Ramón', 'Pérez', '600123456', 'agendar una cita', 'sin-clasificar:']) {
    assert.ok(!texto.includes(fuga), `el informe publica «${fuga}»`);
  }
  // Y sin embargo SÍ dice lo que hace falta saber.
  assert.ok(i.porcentajeDePreguntasRepetidas >= 0);
  assert.ok(i.ranking.length > 0);
});

test('las preguntas sin clasificar se agregan, no se enumeran', () => {
  // Sus claves llevan la frase literal dentro; publicarlas una a una sería
  // publicar la conversación con otro nombre.
  const r = S._sinTexto([
    { intencion: 'ofrecer-cita', repeticiones: 5 },
    { intencion: 'sin-clasificar:tenemos aparcamiento gratuito', repeticiones: 2 },
    { intencion: 'sin-clasificar:aceptamos adeslas', repeticiones: 1 },
  ]);
  assert.deepEqual(r, [
    { intencion: 'ofrecer-cita', repeticiones: 5 },
    { intencion: '(sin clasificar)', repeticiones: 3 },
  ]);
});

test('sin llamadas NO dice que todo va bien', async () => {
  const db = { enabled: true, client: { from: () => ({ select: () => ({ gte: async () => ({ data: [] }) }) }) } };
  const i = await S.informe({ db });
  assert.equal(i.llamadas, 0);
  assert.doesNotMatch(i.resumen, /bien|correcto|sin repetici/i);
  assert.match(i.resumen, /nada que medir/);
});

test('lleva los contadores de los dos arreglos, para saber si ACTÚAN', async () => {
  // Un tope que no se dispara nunca y uno que funciona se ven igual en el
  // porcentaje final. Estos números distinguen los dos casos.
  const i = await S.informe({ db: baseCon(30) });
  assert.equal(i.arreglos.rematesCallados, 30);
  for (const k of ['reintentos', 'reintentosConExito', 'recoveries']) {
    assert.ok(k in i.arreglos, `falta el contador ${k}`);
  }
});

test('la ruta pública existe y no pide sesión', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/api/routes.js'), 'utf8');
  assert.match(src, /app\.get\('\/health\/conversacion'/);
});
