// ============================================================
// NodeFlow — `state` de OAuth de un solo uso (auditoría 2026-07-29, S1)
//
// El bug que estos tests impiden que vuelva: el `state` era el organization_id
// y el callback lo escribía en BD tal cual. Como el org_id es público (sale en
// el HTML de los micrositios y en los enlaces de baja), bastaba con iniciar el
// flujo con la cuenta propia y cambiar `state=<uuid-víctima>` para que los
// tokens del atacante acabaran en la fila de la víctima → todas las citas de
// ese negocio se sincronizaban al calendario del atacante.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { issueOAuthState, consumeOAuthState } = require('../src/auth/oauth-state');

describe('OAuth state de un solo uso', () => {
  test('ida y vuelta: devuelve el orgId que lo emitió', async () => {
    const state = await issueOAuthState('org-aaa', 'google');
    assert.strictEqual(await consumeOAuthState(state, 'google'), 'org-aaa');
  });

  test('el state es opaco: NO contiene el orgId', async () => {
    const orgId = '11111111-2222-3333-4444-555555555555';
    const state = await issueOAuthState(orgId, 'google');
    assert.ok(!state.includes(orgId), 'el state no debe filtrar el orgId');
    assert.match(state, /^[0-9a-f]{64}$/, '256 bits en hex');
  });

  test('SOLO se puede usar una vez (bloquea el replay del callback)', async () => {
    const state = await issueOAuthState('org-aaa', 'google');
    assert.strictEqual(await consumeOAuthState(state, 'google'), 'org-aaa');
    assert.strictEqual(await consumeOAuthState(state, 'google'), null);
  });

  test('dos states del mismo org son distintos e independientes', async () => {
    const a = await issueOAuthState('org-aaa', 'google');
    const b = await issueOAuthState('org-aaa', 'google');
    assert.notStrictEqual(a, b);
    assert.strictEqual(await consumeOAuthState(a, 'google'), 'org-aaa');
    assert.strictEqual(await consumeOAuthState(b, 'google'), 'org-aaa');
  });

  test('EL ATAQUE: un orgId ajeno puesto a mano en la query NO vale como state', async () => {
    // Esto es literalmente lo que hacía el código anterior: state === orgId.
    for (const forged of [
      'org-victima',
      '11111111-2222-3333-4444-555555555555',
      'a'.repeat(64),                     // longitud correcta, nunca emitido
      '0123456789abcdef'.repeat(4),       // hex válido, nunca emitido
    ]) {
      assert.strictEqual(await consumeOAuthState(forged, 'google'), null, `no debe aceptar: ${forged}`);
    }
  });

  test('un state de Google no sirve para el callback de Outlook (ni al revés)', async () => {
    const g = await issueOAuthState('org-aaa', 'google');
    assert.strictEqual(await consumeOAuthState(g, 'outlook'), null);
    assert.strictEqual(await consumeOAuthState(g, 'google'), 'org-aaa'); // sigue intacto
  });

  test('entrada basura → null, sin reventar', async () => {
    for (const bad of [undefined, null, '', 'x', 123, {}, [], 'G'.repeat(64), 'zz' + 'a'.repeat(62)]) {
      assert.strictEqual(await consumeOAuthState(bad, 'google'), null);
    }
  });

  test('emitir sin orgId es un error de programación, no un state anónimo', async () => {
    await assert.rejects(() => issueOAuthState('', 'google'), /orgId requerido/);
    await assert.rejects(() => issueOAuthState(undefined, 'google'), /orgId requerido/);
  });
});
