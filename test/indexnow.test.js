// ============================================================
// NodeFlow — #6 SEO: extracción de URLs del sitemap para IndexNow
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractLocs } = require('../scripts/indexnow-submit');

describe('extractLocs — sitemap → lista de URLs', () => {
  test('extrae todas las <loc> con espacios y saltos de línea', () => {
    const xml = `<?xml version="1.0"?>
      <urlset><url><loc>https://nodeflow.es/</loc></url>
      <url><loc>
        https://nodeflow.es/demo
      </loc></url></urlset>`;
    assert.deepStrictEqual(extractLocs(xml), ['https://nodeflow.es/', 'https://nodeflow.es/demo']);
  });

  test('xml vacío o basura → lista vacía, sin lanzar', () => {
    assert.deepStrictEqual(extractLocs(''), []);
    assert.deepStrictEqual(extractLocs(null), []);
    assert.deepStrictEqual(extractLocs('<loc></loc>'), []);
  });

  test('el sitemap REAL del repo produce >100 URLs, todas del dominio', () => {
    const xml = fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8');
    const urls = extractLocs(xml);
    assert.ok(urls.length > 100, `esperaba >100, hay ${urls.length}`);
    assert.ok(urls.every(u => u.startsWith('https://nodeflow.es')), 'URL fuera de dominio');
  });
});
