'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NO SE PUEDE PUBLICAR UN DATO QUE NO SE SOSTIENE
//
// Apareció limpiando otra cosa: «la Clínica VetBilbao implementó NodeFlow y vio
// un aumento del 15% en nuevos clientes». Tirando del hilo salieron 54 más:
// clínicas que «reportaron» un 40% menos de ausencias, gimnasios con «ROI del
// 150% en el primer año», «según datos internos de academias que utilizan
// NodeFlow». Y 27 frases que citaban estudios inexistentes.
//
// EL DATO QUE LAS DESMONTA TODAS: en producción hay cuatro organizaciones, las
// cuatro son de Unai, y suman cuatro llamadas reales en treinta días. Ningún
// cliente ha reportado nada porque no hay clientes.
//
// Importa más que la promesa del euskera. La empresa se vende diciendo que no
// se inventa nada —que cada decisión de la IA queda registrada y se puede
// repasar— mientras la web enseñaba resultados de clientes que no existen. Un
// comprador que pida ver uno de esos casos descubre que no hay nada detrás, y
// ahí no se pierde una venta: se pierde la credibilidad de todo lo demás,
// incluido lo que sí es verdad.
//
// Este test vigila las DOS formas de inventar: atribuir el dato a un cliente
// que no existe, y atribuirlo a un estudio que tampoco.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
// hementxe es otra empresa; admin es el panel interno, no material de venta.
const FUERA = [/^hementxe\//, /^admin\//];

function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');
const texto = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');

function recorrer(fn) {
  const hits = [];
  for (const f of paginas()) {
    const r = rel(f);
    if (FUERA.some(re => re.test(r))) continue;
    fn(r, fs.readFileSync(f, 'utf8'), hits);
  }
  return hits;
}

test('ninguna página atribuye un resultado a un cliente', () => {
  // «una clínica reportó un 50% menos de ausencias», «los gimnasios que han
  // implementado NodeFlow han visto un ROI de hasta el 150%».
  const RE = /[^.!?<>]{0,180}(han visto|ha visto|reportó|reportaron|han reportado|experimentó|vio un incremento|vio un aumento|datos internos|estudios internos|ROI de(l)? \d|caso de éxito es|ejemplo real es)[^.!?<>]{0,200}\d{1,3}\s?%/gi;
  const hits = recorrer((r, h, acc) => {
    for (const m of texto(h).matchAll(RE)) acc.push(`${r}: «${m[0].replace(/\s+/g, ' ').trim().slice(0, 110)}…»`);
  });
  assert.deepEqual(hits, [],
    'No hay clientes de los que sacar estos números. Cuatro organizaciones en ' +
    'producción, las cuatro propias, cuatro llamadas reales en 30 días:\n  ' +
    hits.join('\n  '));
});

test('ninguna página cita un estudio que no existe', () => {
  // Inventarse la fuente es la misma mentira con menos cara: si mañana alguien
  // pide el estudio, no hay estudio.
  const RE = /(un estudio reciente|según estudios|estudios muestran|estudio de mercado|estudios del sector|según un informe|un estudio de \d{4}|un estudio revela|investigación reciente|estudios demuestran)/gi;
  const hits = recorrer((r, h, acc) => {
    for (const m of texto(h).matchAll(RE)) acc.push(`${r}: «${m[0]}»`);
  });
  assert.deepEqual(hits, [],
    'Citas a estudios que nadie puede enseñar:\n  ' + hits.join('\n  '));
});

test('no vuelven los clientes inventados que ya cazamos', () => {
  const NOMBRES = [/VetBilbao/i, /BilbaoVet/i, /VetUrgencia/i, /Cl[ií]nica Animalia/i,
                   /Corte y Estilo['"]/i];
  const hits = recorrer((r, h, acc) => {
    for (const re of NOMBRES) if (re.test(h)) acc.push(`${r}: ${re.source}`);
  });
  assert.deepEqual(hits, [], 'Clientes inventados de vuelta:\n  ' + hits.join('\n  '));
});

test('la fuente real de la interrupción sigue atribuida', () => {
  // La otra cara: al barrer citas falsas es fácil llevarse por delante la única
  // que SÍ es real. El dato de cuánto cuesta recuperar la concentración tras una
  // interrupción viene del trabajo de Gloria Mark (UC Irvine) y es de lo más
  // útil que dice ese artículo. Se arregló dando la fuente, no borrándolo.
  const f = path.join(PUBLIC, 'blog', 'como-reducir-tiempo-gestion-telefonica-negocio', 'index.html');
  if (!fs.existsSync(f)) return;
  assert.match(fs.readFileSync(f, 'utf8'), /Gloria Mark/,
    'Se ha perdido la atribución real (Gloria Mark, UC Irvine). Ese dato no era ' +
    'inventado: le faltaba la fuente, y ahora la tiene.');
});
