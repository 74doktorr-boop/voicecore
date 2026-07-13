// ============================================================
// NodeFlow — Digest matinal del fundador. Verifica: agregación de
// avisos (onboarding sin número, pool, calidad WA), que NO envía si
// todo está en orden (cero ruido), el gate FOUNDER_DIGEST_DISABLED,
// dry-run, y fail-open por fuente. Deps inyectables, sin red ni BD.
// ============================================================
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { collectDigestItems, runFounderDigest } = require('../src/monitoring/founder-digest');

const SNAP = { ...process.env };
function reset() {
  delete process.env.FOUNDER_DIGEST_DISABLED;
  process.env.NOTIFY_EMAIL = 'unai@nodeflow.es';
  // Config "completa" para que el chequeo de envs no meta ruido en los tests
  process.env.SUPABASE_URL = 'x'; process.env.SUPABASE_SERVICE_KEY = 'x';
  process.env.STRIPE_SECRET_KEY = 'x'; process.env.RESEND_API_KEY = 'x';
  process.env.DEEPGRAM_API_KEY = 'x'; process.env.OPENAI_API_KEY = 'x';
  delete process.env.WA_PHONE_NUMBER_ID; delete process.env.WA_ACCESS_TOKEN;
}
beforeEach(reset);
afterEach(() => { process.env = { ...SNAP }; });

// BD falsa: registros activos + orgs con/sin número
function fakeDb({ registros = [], orgs = [] } = {}) {
  const table = (rows) => ({
    select() { return this; }, eq() { return this; }, in() { return this; },
    limit() { return Promise.resolve({ data: rows }); },
    then(res) { return Promise.resolve({ data: rows }).then(res); },
  });
  return {
    enabled: true,
    client: { from: (name) => name === 'registros' ? table(registros) : table(orgs) },
  };
}

describe('collectDigestItems', () => {
  test('cliente pagado sin número → aviso crítico', async () => {
    const db = fakeDb({
      registros: [{ negocio: 'Fisio Ordizia', email: 'f@x.com' }],
      orgs: [{ owner_email: 'f@x.com', automation_config: { config: {} } }],
    });
    const items = await collectDigestItems({ db, poolStats: async () => ({ available: 3, low: false }), waQuality: null });
    assert.equal(items.length, 1);
    assert.equal(items[0].sev, 'crit');
    assert.match(items[0].txt, /SIN número/);
    assert.match(items[0].sub, /Fisio Ordizia/);
  });

  test('pool vacío → crítico; pool bajo → aviso', async () => {
    const db = fakeDb({ registros: [], orgs: [] });
    const empty = await collectDigestItems({ db, poolStats: async () => ({ available: 0, assigned: 4 }), waQuality: null });
    assert.ok(empty.some(i => i.sev === 'crit' && /VACÍO/.test(i.txt)));
    const low = await collectDigestItems({ db, poolStats: async () => ({ available: 1, low: true }), waQuality: null });
    assert.ok(low.some(i => i.sev === 'warn' && /bajo/.test(i.txt)));
  });

  test('calidad WA YELLOW → aviso; RED → crítico; GREEN → nada', async () => {
    const db = fakeDb({ registros: [], orgs: [] });
    const pool = async () => ({ available: 3, low: false });
    const y = await collectDigestItems({ db, poolStats: pool, waQuality: 'YELLOW' });
    assert.ok(y.some(i => i.sev === 'warn' && /YELLOW/.test(i.txt)));
    const r = await collectDigestItems({ db, poolStats: pool, waQuality: 'RED' });
    assert.ok(r.some(i => i.sev === 'crit' && /RED/.test(i.txt)));
    const g = await collectDigestItems({ db, poolStats: pool, waQuality: 'GREEN' });
    assert.equal(g.length, 0);
  });

  test('fail-open: una fuente que revienta no tumba el digest', async () => {
    const db = fakeDb({ registros: [], orgs: [] });
    const items = await collectDigestItems({ db, poolStats: async () => { throw new Error('boom'); }, waQuality: 'YELLOW' });
    assert.ok(items.some(i => /YELLOW/.test(i.txt))); // las demás fuentes siguen
  });
});

describe('runFounderDigest', () => {
  const okDeps = (extra = {}) => ({
    db: fakeDb({ registros: [], orgs: [] }),
    poolStats: async () => ({ available: 0, assigned: 2 }), // algo rojo para que envíe
    waQuality: null,
    ...extra,
  });

  test('todo en orden → NO envía (cero ruido)', async () => {
    let sent = false;
    const r = await runFounderDigest({
      db: fakeDb({ registros: [], orgs: [] }),
      poolStats: async () => ({ available: 3, low: false }),
      waQuality: null,
      sendEmail: async () => { sent = true; return true; },
    });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'all_ok');
    assert.equal(sent, false);
  });

  test('con avisos → envía al NOTIFY_EMAIL con el conteo', async () => {
    let captured = null;
    const r = await runFounderDigest(okDeps({ sendEmail: async (e) => { captured = e; return true; } }));
    assert.equal(r.sent, true);
    assert.equal(captured.to, 'unai@nodeflow.es');
    assert.match(captured.subject, /1 tema/);
    assert.match(captured.html, /VACÍO/);
    assert.match(captured.html, /admin/); // enlace al panel
  });

  test('FOUNDER_DIGEST_DISABLED=true → no hace nada', async () => {
    process.env.FOUNDER_DIGEST_DISABLED = 'true';
    const r = await runFounderDigest(okDeps({ sendEmail: async () => { throw new Error('no debería'); } }));
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'disabled');
  });

  test('sin NOTIFY_EMAIL → no envía', async () => {
    delete process.env.NOTIFY_EMAIL;
    const r = await runFounderDigest(okDeps());
    assert.equal(r.reason, 'no_email');
  });

  test('dryRun → devuelve conteo sin enviar', async () => {
    let sent = false;
    const r = await runFounderDigest(okDeps({ dryRun: true, sendEmail: async () => { sent = true; return true; } }));
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'dry_run');
    assert.equal(r.items, 1);
    assert.equal(sent, false);
  });
});
