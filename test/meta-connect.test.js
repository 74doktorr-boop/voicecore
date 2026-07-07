// ============================================================
// NodeFlow — Conexión de número propio por Meta directo (Fase 2)
// El self-service Embedded Signup: el negocio autoriza en el popup
// de Meta y este backend intercambia el code por el token, registra
// el número, suscribe nuestra app a su WABA y da de alta las 3
// plantillas. Todo con la Graph API inyectable → testeable con mocks
// sin depender de la app de Meta real (que llega cuando desbloqueen).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { WA_TEMPLATES } = require('../src/whatsapp/templates');
const {
  exchangeCodeForToken, registerNumber, subscribeAppToWaba,
  submitTemplates, connectMetaNumber,
} = require('../src/whatsapp/meta-connect');

// Mock de la Graph API: registra las llamadas y devuelve lo programado.
function fakeGraph(script) {
  const calls = [];
  const graph = async (method, path, { token, body } = {}) => {
    calls.push({ method, path, token, body });
    const match = script.find(s => path.includes(s.match));
    return match ? match.res : { status: 200, body: {} };
  };
  graph.calls = calls;
  return graph;
}

describe('exchangeCodeForToken', () => {
  const APP = { appId: 'app123', appSecret: 'secret' };

  test('code válido → token de negocio', async () => {
    const graph = fakeGraph([{ match: 'oauth/access_token', res: { status: 200, body: { access_token: 'EAABIZ' } } }]);
    const out = await exchangeCodeForToken('CODE', { graph, ...APP });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.token, 'EAABIZ');
    assert.match(graph.calls[0].path, /client_id=app123/);
    assert.match(graph.calls[0].path, /code=CODE/);
  });

  test('sin app configurada → error sin llamar a Meta', async () => {
    const graph = fakeGraph([]);
    const out = await exchangeCodeForToken('CODE', { graph, appId: '', appSecret: '' });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(graph.calls.length, 0);
  });

  test('Meta rechaza el code → error con mensaje', async () => {
    const graph = fakeGraph([{ match: 'oauth/access_token', res: { status: 400, body: { error: { message: 'code caducado' } } } }]);
    const out = await exchangeCodeForToken('CODE', { graph, ...APP });
    assert.strictEqual(out.ok, false);
    assert.match(out.error, /caducado/);
  });
});

describe('registerNumber / subscribeAppToWaba', () => {
  test('registerNumber hace POST /{id}/register con PIN', async () => {
    const graph = fakeGraph([{ match: '/register', res: { status: 200, body: { success: true } } }]);
    const out = await registerNumber('TOK', 'PNID', { graph });
    assert.strictEqual(out.ok, true);
    assert.match(graph.calls[0].path, /PNID\/register/);
    assert.strictEqual(graph.calls[0].body.messaging_product, 'whatsapp');
    assert.ok(graph.calls[0].body.pin, 'debe mandar un PIN');
  });

  test('subscribeAppToWaba hace POST /{waba}/subscribed_apps', async () => {
    const graph = fakeGraph([{ match: 'subscribed_apps', res: { status: 200, body: { success: true } } }]);
    const out = await subscribeAppToWaba('TOK', 'WABA1', { graph });
    assert.strictEqual(out.ok, true);
    assert.match(graph.calls[0].path, /WABA1\/subscribed_apps/);
    assert.strictEqual(graph.calls[0].token, 'TOK');
  });
});

describe('submitTemplates', () => {
  test('da de alta TODAS las plantillas en el WABA del cliente', async () => {
    const graph = fakeGraph([{ match: 'message_templates', res: { status: 200, body: { id: 't1' } } }]);
    const out = await submitTemplates('TOK', 'WABA1', { graph });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.submitted, WA_TEMPLATES.length, 'todas las plantillas');
    assert.ok(graph.calls.every(c => /WABA1\/message_templates/.test(c.path)));
    const names = graph.calls.map(c => c.body.name);
    assert.ok(names.includes('nodeflow_cita_confirmada'));
    assert.ok(names.includes('nodeflow_cita_recordatorio'));
    assert.ok(names.includes('nodeflow_resena'));
    assert.ok(names.includes('nodeflow_reactivacion'));
  });

  test('si una plantilla falla, sigue con las demás y no lanza', async () => {
    let n = 0;
    const graph = async (m, p, opts) => { n++; return n === 1 ? { status: 400, body: { error: { message: 'x' } } } : { status: 200, body: { id: 't' } }; };
    const out = await submitTemplates('TOK', 'WABA1', { graph });
    assert.strictEqual(out.submitted, WA_TEMPLATES.length - 1, 'todas menos la que falló');
    assert.strictEqual(out.ok, true);
  });
});

describe('connectMetaNumber — orquestación completa', () => {
  function deps(script) {
    const graph = fakeGraph(script);
    const saved = {};
    return {
      graph, appId: 'app123', appSecret: 'secret',
      saveWaCredentials: async (businessId, creds) => { saved.businessId = businessId; saved.creds = creds; },
      _saved: saved,
    };
  }
  const OK_SCRIPT = [
    { match: 'oauth/access_token', res: { status: 200, body: { access_token: 'EAABIZ' } } },
    { match: '/register', res: { status: 200, body: { success: true } } },
    { match: 'subscribed_apps', res: { status: 200, body: { success: true } } },
    { match: 'message_templates', res: { status: 200, body: { id: 't' } } },
  ];

  test('camino feliz: intercambia, registra, suscribe, planifica y guarda credenciales', async () => {
    const d = deps(OK_SCRIPT);
    const out = await connectMetaNumber('org-1', {
      code: 'CODE', phoneNumberId: 'PNID', wabaId: 'WABA1', phoneNumber: '+34843700849',
    }, d);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(d._saved.businessId, 'org-1');
    assert.strictEqual(d._saved.creds.phoneNumberId, 'PNID');
    assert.strictEqual(d._saved.creds.accessToken, 'EAABIZ');
    assert.strictEqual(d._saved.creds.apiBase, null, 'Meta directo');
    assert.strictEqual(d._saved.creds.wabaId, 'WABA1');
  });

  test('si el intercambio del code falla, NO guarda credenciales', async () => {
    const d = deps([{ match: 'oauth/access_token', res: { status: 400, body: { error: { message: 'code malo' } } } }]);
    const out = await connectMetaNumber('org-1', { code: 'BAD', phoneNumberId: 'PNID', wabaId: 'WABA1', phoneNumber: '+34' }, d);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(d._saved.businessId, undefined, 'no debe guardar credenciales parciales');
  });

  test('faltan campos → error sin tocar Meta', async () => {
    const d = deps(OK_SCRIPT);
    const out = await connectMetaNumber('org-1', { code: 'CODE' }, d);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(d.graph.calls.length, 0);
  });

  // El popup del Embedded Signup (sessionInfo v3) NO trae el número visible:
  // el backend debe leerlo de la Graph API y guardar también el nombre verificado.
  test('sin phoneNumber (flujo self-service) → lo lee de la Graph API', async () => {
    const d = deps([
      { match: 'fields=display_phone_number', res: { status: 200, body: { display_phone_number: '+34 600 11 22 33', verified_name: 'Clínica Sol' } } },
      ...OK_SCRIPT,
    ]);
    const out = await connectMetaNumber('org-1', { code: 'CODE', phoneNumberId: 'PNID', wabaId: 'WABA1' }, d);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.phoneNumber, '+34 600 11 22 33');
    assert.strictEqual(d._saved.creds.phoneNumber, '+34 600 11 22 33');
    assert.strictEqual(d._saved.creds.displayName, 'Clínica Sol');
  });

  test('sin phoneNumber y la Graph API no lo da → aborta sin guardar', async () => {
    const d = deps(OK_SCRIPT); // sin entrada para fields=display_phone_number → body vacío
    const out = await connectMetaNumber('org-1', { code: 'CODE', phoneNumberId: 'PNID', wabaId: 'WABA1' }, d);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(d._saved.businessId, undefined, 'no debe guardar credenciales sin número');
  });
});
