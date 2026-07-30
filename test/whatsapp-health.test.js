// ============================================================
// NodeFlow — WhatsApp bloqueado y nadie se entera (2026-07-30)
//
// Al ir a dar de alta una plantilla, Meta contestó «API access blocked»
// (OAuthException, code 200). No era la plantilla: era la cuenta. Con eso
// bloqueado no sale NADA — confirmaciones, recordatorios 24h antes, reseñas,
// reactivaciones — y hierros a freixa las tiene las cuatro encendidas.
//
// El sistema no lo notaba: cada envío fallido escribe un log.warn y sigue. El
// negocio se entera cuando un cliente no aparece a una cita de la que nunca
// recibió recordatorio.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { clasificarRespuestaMeta, nivelDe, sondearWhatsApp } = require('../src/monitoring/whatsapp-health');
const { buildSystemAudit } = require('../src/monitoring/system-audit');

const errorMeta = (code, message) => ({ error: { message, type: 'OAuthException', code } });

describe('clasificarRespuestaMeta', () => {
  test('EL CASO REAL: code 200 «API access blocked» → bloqueado, y CRÍTICO', () => {
    const r = clasificarRespuestaMeta(400, errorMeta(200, 'API access blocked.'));
    assert.strictEqual(r.estado, 'bloqueado');
    assert.strictEqual(nivelDe(r.estado), 'critico');
    assert.match(r.detalle, /ni recordatorios/);
  });

  test('no encadena dos puntos: Meta ya termina sus mensajes en punto', () => {
    const r = clasificarRespuestaMeta(400, errorMeta(200, 'API access blocked.'));
    assert.ok(!/\.\./.test(r.detalle), `sale feo: "${r.detalle.slice(0, 40)}"`);
    assert.match(r.detalle, /^API access blocked\. NO sale/);
  });

  test('y dice explícitamente que renovar el token NO lo arregla', () => {
    // Es el error que se comete: ver "OAuth" y pensar que es el token.
    const r = clasificarRespuestaMeta(400, errorMeta(200, 'API access blocked.'));
    assert.match(r.detalle, /token nuevo NO lo arregla/i);
    assert.match(r.detalle, /Business Manager/);
  });

  test('code 190 SÍ es el token, y la salida es otra', () => {
    const r = clasificarRespuestaMeta(400, errorMeta(190, 'Error validating access token'));
    assert.strictEqual(r.estado, 'token');
    assert.strictEqual(nivelDe(r.estado), 'critico');
    assert.match(r.detalle, /WA_ACCESS_TOKEN/);
    assert.ok(!/Business Manager/.test(r.detalle), 'ese consejo es para el bloqueo, no para el token');
  });

  test('un límite de peticiones es aviso, no crítico: se pasa solo', () => {
    assert.strictEqual(clasificarRespuestaMeta(400, errorMeta(4, 'rate limit')).estado, 'limite');
    assert.strictEqual(nivelDe('limite'), 'aviso');
  });

  test('todo bien → ok y sin ruido', () => {
    const r = clasificarRespuestaMeta(200, { id: '2548201375610184' });
    assert.strictEqual(r.estado, 'ok');
    assert.strictEqual(nivelDe('ok'), 'ok');
  });

  test('sin conexión no se acusa a Meta: puede ser red nuestra', () => {
    const r = clasificarRespuestaMeta(0, { error: { message: 'fetch failed' } });
    assert.strictEqual(r.estado, 'error');
    assert.match(r.detalle, /red nuestra/);
  });

  test('un error desconocido no se traga: sale con su código', () => {
    const r = clasificarRespuestaMeta(500, errorMeta(999, 'algo raro'));
    assert.strictEqual(r.estado, 'error');
    assert.match(r.detalle, /999/);
    assert.match(r.detalle, /algo raro/);
  });

  test('entrada vacía no revienta', () => {
    assert.doesNotThrow(() => clasificarRespuestaMeta());
    assert.doesNotThrow(() => clasificarRespuestaMeta(400, null));
  });
});

describe('sondearWhatsApp', () => {
  test('sin credenciales no inventa un problema', async () => {
    const r = await sondearWhatsApp({ token: '', wabaId: '', fetch: () => { throw new Error('no debería llamar'); } });
    assert.strictEqual(r.estado, 'sin_configurar');
  });

  test('reproduce el bloqueo real contra un Meta simulado', async () => {
    const r = await sondearWhatsApp({
      token: 't', wabaId: 'w',
      fetch: async () => ({ status: 400, json: async () => errorMeta(200, 'API access blocked.') }),
    });
    assert.strictEqual(r.estado, 'bloqueado');
  });

  test('si la red falla, devuelve error en vez de lanzar', async () => {
    const r = await sondearWhatsApp({ token: 't', wabaId: 'w', fetch: async () => { throw new Error('ECONNRESET'); } });
    assert.strictEqual(r.estado, 'error');
    assert.match(r.detalle, /ECONNRESET/);
  });
});

describe('sale en la auditoría nocturna', () => {
  const sana = () => ({ status: 'ended', turn_count: 4, duration_ms: 90000, metrics: { turns: [{ firstAudioMs: 600 }], quality: {} } });

  test('un WhatsApp bloqueado hace CRÍTICO el informe entero', () => {
    const r = buildSystemAudit({
      llamadas: [sana(), sana(), sana()],
      whatsapp: clasificarRespuestaMeta(400, errorMeta(200, 'API access blocked.')),
    });
    assert.strictEqual(r.severidad, 'critico');
    const l = r.lineas.find(x => /BLOQUEADO/.test(x.titulo));
    assert.ok(l, 'tiene que salir con todas las letras');
    assert.match(l.detalle, /confirmaciones de cita/);
  });

  test('con WhatsApp bien, ni se menciona', () => {
    const r = buildSystemAudit({ llamadas: [sana()], whatsapp: { estado: 'ok', titulo: 'WhatsApp responde', detalle: '' } });
    assert.ok(!r.lineas.some(x => /WhatsApp/.test(x.titulo)));
  });

  test('sin WhatsApp configurado tampoco se queja', () => {
    const r = buildSystemAudit({ llamadas: [sana()], whatsapp: { estado: 'sin_configurar' } });
    assert.ok(!r.lineas.some(x => /WhatsApp/.test(x.titulo)));
  });
});
