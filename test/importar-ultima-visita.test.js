'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTAS 500 CLIENTES QUE LLEVAN UN AÑO SIN VENIR Y EL PANEL DICE «0 DORMIDOS»
//
// Dos mitades construidas y sin tocarse, otra vez:
//
//   · `contact-import.js` metía los contactos con `call_count: 0` y sin
//     `last_call_at`.
//   · Y el contador de «clientes que no vuelven» filtra por
//     `last_call_at IS NOT NULL AND last_call_at < corte AND call_count >= 1`.
//
// O sea que un negocio recién dado de alta podía subir su fichero entero de
// clientes y el panel seguía diciendo cero. Y ahí se cae la única victoria que
// se le puede dar a alguien en su PRIMERA semana, antes de que suene el primer
// teléfono: decirle a cuántos clientes ha perdido y cuánto vale eso.
//
// Con una columna de última visita, la importación deja de ser una lista de
// teléfonos y pasa a ser la respuesta a «¿a cuántos he perdido?» el día 1.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseImportCsv } = require('../src/lifecycle/contact-import');

const hoy = () => new Date().toISOString().slice(0, 10);
const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('reconoce la columna de última visita, se llame como se llame', () => {
  // Cada software de gestión la llama distinto. Si solo se aceptara un nombre,
  // el 90% de los ficheros entrarían sin fecha y el contador seguiría a cero.
  for (const cab of ['Ultima visita', 'última cita', 'FECHA_ULTIMA_VISITA', 'ultimo servicio', 'Last Visit']) {
    const r = parseImportCsv(`Nombre;Telefono;${cab}\nAna;600111222;12/03/2025`);
    assert.equal(r.rows.length, 1, `no parseó con la cabecera «${cab}»`);
    assert.equal(r.rows[0].ultimaVisita, '2025-03-12', `no leyó la fecha con la cabecera «${cab}»`);
  }
});

test('acepta dd/mm/aaaa y también ISO', () => {
  assert.equal(parseImportCsv('Nombre;Telefono;Ultima visita\nA;600111222;2024-11-05').rows[0].ultimaVisita, '2024-11-05');
  assert.equal(parseImportCsv('Nombre;Telefono;Ultima visita\nA;600111222;05-11-2024').rows[0].ultimaVisita, '2024-11-05');
});

test('una fecha en el FUTURO no es una última visita', () => {
  // Casi siempre es una columna de «próxima cita» mal mapeada. Aceptarla dejaría
  // al cliente como recién visto para siempre — invisible en el contador de
  // dormidos, que es justo lo que se viene a arreglar.
  const r = parseImportCsv(`Nombre;Telefono;Ultima visita\nA;600111222;${enDias(30)}`);
  assert.equal(r.rows[0].ultimaVisita, null);
  // Y hoy sí vale.
  assert.equal(parseImportCsv(`Nombre;Telefono;Ultima visita\nA;600111222;${hoy()}`).rows[0].ultimaVisita, hoy());
});

test('una fecha ilegible NO tira la fila entera', () => {
  // El teléfono y el nombre siguen valiendo. Perder el contacto por una fecha
  // mal escrita sería un pésimo intercambio — y en un fichero de 500 filas
  // exportado a mano, las fechas raras son la norma.
  const r = parseImportCsv('Nombre;Telefono;Ultima visita\nAna;600111222;el año pasado');
  assert.equal(r.rows.length, 1, 'ha descartado la fila por la fecha');
  assert.equal(r.rows[0].phone.includes('600111222'), true);
  assert.equal(r.rows[0].ultimaVisita, null);
});

test('sin columna de última visita, todo sigue funcionando igual', () => {
  // No se puede romper la importación de quien ya la usaba con el formato viejo.
  const r = parseImportCsv('Nombre;Telefono;Caduca_el\nAna;600111222;01/06/2026');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].ultimaVisita, null);
  assert.equal(r.rows[0].sectorData.fecha_caducidad_psicotecnico, '2026-06-01');
});

test('el alta escribe call_count 1 con última visita, y 0 sin ella', () => {
  // Es LA línea del arreglo. Con `call_count: 0` el filtro de dormidos
  // (`call_count >= 1`) descarta la fila entera, y una lista de gente que lleva
  // un año sin aparecer sigue contando cero.
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/lifecycle/contact-import.js'), 'utf8');
  assert.match(src, /r\.ultimaVisita[\s\S]{0,120}call_count: 1/,
    'con última visita hay que escribir call_count 1, o el contador de dormidos la ignora');
  assert.match(src, /last_call_at: _fechaAIso\(r\.ultimaVisita\)/);
});

test('la última visita solo AVANZA, nunca retrocede', () => {
  // Si el cliente ya nos llamó después de la fecha del fichero, el fichero está
  // más viejo que nosotros: pisarlo resucitaría como dormido a un cliente activo
  // y le llegaría una campaña de «te echamos de menos» al que vino ayer.
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/lifecycle/contact-import.js'), 'utf8');
  assert.match(src, /_mayor\(r\.ultimaVisita, ex\.last_call_at\)/);
  assert.match(src, /select\('id, phone, name, email, sector_data, last_call_at, call_count'\)/,
    'sin traer last_call_at, la comparación cree siempre que no había fecha previa');
});
