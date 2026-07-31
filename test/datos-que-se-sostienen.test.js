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

test('ningún artículo abre con una cifra sin fuente', () => {
  // Los 39 «¿Sabías que el 70%…?» eran el mismo porcentaje reciclado con
  // distinto sujeto, y con precisión local inventada: «el 45% de las clínicas
  // de fisioterapia EN VITORIA-GASTEIZ». Nadie ha encuestado a los fisios de
  // Vitoria. Ahora, o llevan fuente citada con sus límites, o son una pregunta
  // concreta sin cifra — que además interpela más que el porcentaje.
  const FUENTES = /Invoca|INE|revisiones sistemáticas|Gloria Mark/;
  const hits = recorrer((r, h, acc) => {
    for (const m of texto(h).matchAll(/¿Sabías que[^?]{0,200}\?/g)) {
      if (/\d{1,3}\s?%/.test(m[0]) && !FUENTES.test(m[0])) {
        acc.push(`${r}: «${m[0].replace(/\s+/g, ' ').trim().slice(0, 100)}»`);
      }
    }
  });
  assert.deepEqual(hits, [],
    'Artículos que vuelven a abrir con un porcentaje que nadie ha medido:\n  ' +
    hits.join('\n  '));
});

test('las fuentes citadas son las tres que se verificaron', () => {
  // Contrapeso del test anterior: éste pasaría igual si alguien inventara una
  // fuente nueva de nombre convincente. Estas tres se comprobaron una a una y
  // son las únicas admitidas hasta que se verifique otra:
  //   · Invoca (2024), 60M+ llamadas analizadas
  //   · revisiones sistemáticas de recordatorios de cita en sanidad
  //   · INE, encuesta de TIC y comercio electrónico
  // Se descartó a propósito el famoso «62%»: sale de un estudio de 411 Locals
  // de 2016 SIN metodología publicada, y no pasa el mismo listón con el que se
  // barrieron 76 afirmaciones.
  const hits = recorrer((r, h, acc) => {
    if (/411 Locals|el 62% de las llamadas/i.test(texto(h))) acc.push(`${r}: vuelve el 62% de 411 Locals`);
  });
  assert.deepEqual(hits, [], hits.join('\n  '));
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

test('tampoco se atribuye un resultado a un cliente SIN cifra', () => {
  // Este test existe por un error mio, y merece quedar escrito. Anoche di por
  // cerrado esto con un "cero" que era falso, por dos motivos a la vez:
  //
  //   1. El recuento que use llevaba `return` donde iba `continue` al recorrer
  //      directorios: abandonaba la carpeta al primer fichero no-HTML. Miraba
  //      una fraccion del sitio y daba cero con aplomo.
  //   2. Y el patron solo cazaba «han visto», «reporto», «tras implementar».
  //      No cazaba «los negocios de Andoain QUE LO USAN», ni «las clinicas QUE
  //      USAN recordatorios», ni «un caso de exito es una clinica en San
  //      Sebastian que paso una auditoria de RGPD» — que dicen lo mismo, sin
  //      un solo porcentaje, y por eso ningun patron numerico las veia.
  //
  // Un recuento no demuestra ausencia: demuestra que TU patron no encontro
  // nada. Sobrevivieron 13 afirmaciones a la primera pasada.
  const RE = /caso[s]? de exito(?! de un folleto)|caso[s]? de éxito(?! de un folleto)|que (lo |la )?usan reportan|que (lo |la )?utilizan han visto|han visto un|reportan un aumento|tras adoptar NodeFlow|tras implementar NodeFlow/i;
  const hits = recorrer((r, h, acc) => {
    const t = texto(h);
    for (const m of t.matchAll(new RegExp(RE.source, 'gi'))) {
      acc.push(`${r}: «…${t.slice(Math.max(0, m.index - 30), m.index + 70).trim()}…»`);
    }
  });
  assert.deepEqual(hits, [],
    'Vuelven las afirmaciones sobre lo que consiguen los clientes. No hay ' +
    'clientes: cuatro organizaciones en producción, las cuatro propias:\n  ' +
    hits.join('\n  '));
});
