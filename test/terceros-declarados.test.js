// ============================================================
// NodeFlow — Todo tercero que reciba la IP del visitante, declarado (2026-07-30)
//
// POR QUÉ EXISTE: el 30/07 escribí la declaración de servicios externos mirando
// public/index.html, vi Fontshare, y di por hecho que el sitio entero cargaba lo
// mismo. Falso: 133 páginas —el blog entero— cargaban Google Fonts. Google es
// además el caso peor, porque es una empresa estadounidense y es literalmente la
// del fallo alemán sobre fuentes embebidas.
//
// O sea que publiqué un documento LEGAL con una lista incompleta por generalizar
// desde un fichero. Una revisión a ojo de 179 páginas no se hace, y por eso la
// hace esto: si alguien añade un CDN, un píxel o una fuente nueva y no lo
// declara, rompe un test.
//
// Se miran solo CARGAS de recursos (script/link/img/iframe), no los enlaces del
// texto: enlazar a aepd.es no manda ningún dato a la AEPD.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

function htmlsDe(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlsDe(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

// Etiquetas que PIDEN un archivo al cargar la página: ahí es donde viaja la IP.
const CARGAS = /<(?:script|link|img|iframe)\b[^>]*?(?:src|href)\s*=\s*["'](?:https?:)?\/\/([^/"'?]+)/gi;

function tercerosQueCargan() {
  const hosts = new Map();   // host → páginas que lo cargan
  for (const f of htmlsDe(PUBLIC)) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(CARGAS)) {
      const host = m[1].toLowerCase();
      if (/(^|\.)nodeflow\.es$/.test(host)) continue;   // propio: no es un tercero
      if (!hosts.has(host)) hosts.set(host, []);
      const rel = path.relative(PUBLIC, f);
      if (hosts.get(host).length < 3) hosts.get(host).push(rel);
    }
  }
  return hosts;
}

// Cómo se llama cada host en la política. Se declara por MARCA, no por dominio:
// nadie escribe "cdn.fontshare.com" en un documento legal.
const DECLARADO_COMO = [
  { re: /fontshare\.com$/,        nombre: 'Fontshare' },
  { re: /googleapis\.com$/,       nombre: 'Google Fonts' },
  { re: /gstatic\.com$/,          nombre: 'Google Fonts' },
  { re: /plausible\.io$/,         nombre: 'Plausible' },
  { re: /googletagmanager\.com$/, nombre: 'Google Analytics 4' },
  { re: /jsdelivr\.net$/,         nombre: 'jsDelivr' },
  { re: /qrserver\.com$/,         nombre: 'QR Server' },
];

describe('los terceros que cargan las páginas están declarados', () => {
  const hosts = tercerosQueCargan();
  const privacidad = fs.readFileSync(path.join(PUBLIC, 'privacidad', 'index.html'), 'utf8');

  test('se detecta algo: si esto sale vacío, el propio test está roto', () => {
    assert.ok(hosts.size > 0, 'ninguna carga externa detectada — revisa el regex');
  });

  test('cada host externo tiene un nombre con el que declararlo', () => {
    const sinNombre = [...hosts.keys()].filter(h => !DECLARADO_COMO.some(d => d.re.test(h)));
    assert.deepStrictEqual(sinNombre, [],
      `Terceros nuevos sin declarar. Añádelos al apartado 09 de /privacidad y a esta lista:\n` +
      sinNombre.map(h => `  · ${h} — p.ej. en ${(hosts.get(h) || []).join(', ')}`).join('\n'));
  });

  test('y ese nombre aparece en la política de privacidad', () => {
    const faltan = [];
    for (const host of hosts.keys()) {
      const d = DECLARADO_COMO.find(x => x.re.test(host));
      if (d && !privacidad.includes(d.nombre)) faltan.push(`${d.nombre} (${host})`);
    }
    assert.deepStrictEqual(faltan, [],
      `Se cargan pero NO están en /privacidad: ${faltan.join(', ')}`);
  });

  test('EL FALLO REAL: el blog carga Google y la política tiene que decirlo', () => {
    // Fijado a propósito con nombre y apellidos. Cuando el barrido de marca
    // termine y el blog deje de cargar Google, este test avisará de que sobra
    // la mención — que también es una forma de mentir.
    const cargaGoogle = [...hosts.keys()].some(h => /googleapis\.com$|gstatic\.com$/.test(h));
    assert.strictEqual(privacidad.includes('Google Fonts'), cargaGoogle,
      cargaGoogle
        ? 'el sitio carga Google Fonts y la política no lo dice'
        : 'ya no se carga Google Fonts: sobra la mención en la política');
  });

  test('EL FALLO GRAVE: si hay GA4, no se puede afirmar que no hay seguimiento', () => {
    // GA4 por defecto (gtag('config') a secas, sin consent mode) instala las
    // cookies _ga. La política decía "No hay cookies publicitarias, ni de
    // seguimiento, ni de perfilado" mientras 162 páginas lo cargaban: falso, y
    // en un documento legal. Esta es la afirmación que hay que mantener honesta.
    const hayGA4 = [...hosts.keys()].some(h => /googletagmanager\.com$/.test(h));
    if (hayGA4) {
      assert.ok(privacidad.includes('Google Analytics 4'),
        'se carga GA4 y la política no lo menciona');
      assert.ok(!/No hay cookies publicitarias, ni de seguimiento, ni de perfilado/.test(privacidad),
        'esa frase es FALSA mientras GA4 esté puesto: instala cookies _ga');
    } else {
      assert.ok(!privacidad.includes('Google Analytics 4'),
        'ya no se carga GA4: la política no debe seguir diciendo que sí');
    }
  });
});
