// ============================================================
// NodeFlow — Renovación de tokens WA de 60 días (2026-07-07)
// La configuración del Embedded Signup emite tokens que caducan a
// los 60 días; el cron los renueva a los 45 usando updated_at como
// reloj (sin migración). Fallo de un negocio no frena a los demás.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { refreshExpiringWaTokens } = require('../src/whatsapp/token-refresh');
const { refreshBusinessToken } = require('../src/whatsapp/meta-connect');

describe('refreshBusinessToken — fb_exchange_token', () => {
  const APP = { appId: 'app123', appSecret: 'secret' };

  test('token válido → token nuevo de 60 días', async () => {
    const calls = [];
    const graph = async (method, path) => { calls.push({ method, path }); return { status: 200, body: { access_token: 'NUEVO' } }; };
    const out = await refreshBusinessToken('VIEJO', { graph, ...APP });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.token, 'NUEVO');
    assert.match(calls[0].path, /grant_type=fb_exchange_token/);
    assert.match(calls[0].path, /fb_exchange_token=VIEJO/);
  });

  test('token revocado → error legible', async () => {
    const graph = async () => ({ status: 400, body: { error: { message: 'Token inválido' } } });
    const out = await refreshBusinessToken('VIEJO', { graph, ...APP });
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /Token inválido/);
  });

  test('sin app configurada → error sin llamar a Meta', async () => {
    const out = await refreshBusinessToken('VIEJO', { graph: async () => { throw new Error('no debería'); }, appId: '', appSecret: '' });
    assert.strictEqual(out.ok, false);
  });
});

describe('refreshExpiringWaTokens — ciclo completo', () => {
  function deps({ stale, refreshOk = true }) {
    const updated = [];
    return {
      listStale: async () => stale,
      getCreds: async (orgId) => (orgId === 'sin-creds' ? null : { accessToken: 'TOKEN-' + orgId }),
      refresh: async (token) => (refreshOk ? { ok: true, token: token + '-R' } : { ok: false, error: 'revocado' }),
      updateToken: async (orgId, token) => { updated.push({ orgId, token }); },
      _updated: updated,
    };
  }

  test('renueva todos los tokens viejos y guarda los nuevos', async () => {
    const d = deps({ stale: [{ organization_id: 'org-1' }, { organization_id: 'org-2' }] });
    const s = await refreshExpiringWaTokens(d);
    assert.deepStrictEqual(s, { checked: 2, refreshed: 2, failed: 0 });
    assert.deepStrictEqual(d._updated, [
      { orgId: 'org-1', token: 'TOKEN-org-1-R' },
      { orgId: 'org-2', token: 'TOKEN-org-2-R' },
    ]);
  });

  test('un negocio con token revocado no frena al resto', async () => {
    const d = deps({ stale: [{ organization_id: 'sin-creds' }, { organization_id: 'org-2' }] });
    const s = await refreshExpiringWaTokens(d);
    assert.strictEqual(s.refreshed, 1);
    assert.strictEqual(s.failed, 1);
    assert.strictEqual(d._updated.length, 1, 'solo el sano se actualiza');
  });

  test('renovación fallida NO sobreescribe el token actual', async () => {
    const d = deps({ stale: [{ organization_id: 'org-1' }], refreshOk: false });
    const s = await refreshExpiringWaTokens(d);
    assert.deepStrictEqual(s, { checked: 1, refreshed: 0, failed: 1 });
    assert.strictEqual(d._updated.length, 0);
  });

  test('sin cuentas viejas → no-op silencioso', async () => {
    const s = await refreshExpiringWaTokens({ listStale: async () => [] });
    assert.deepStrictEqual(s, { checked: 0, refreshed: 0, failed: 0 });
  });

  test('la BD caída no lanza — resumen vacío', async () => {
    const s = await refreshExpiringWaTokens({ listStale: async () => { throw new Error('db down'); } });
    assert.deepStrictEqual(s, { checked: 0, refreshed: 0, failed: 0 });
  });
});
