// ============================================================
// NodeFlow — Auditoría técnica nocturna (2026-07-29)
//
// Vive DENTRO de la app y no en un agente programado: la app corre 24/7 en el
// servidor, tiene las credenciales de producción y ya tiene elección de líder.
// Un agente correría en un portátil que se apaga.
//
// Y ENVÍA SIEMPRE, también cuando está todo bien. Es deliberado: founder-digest
// no manda nada si no hay novedades, y eso hace que "todo en orden" y "el cron
// está muerto" se vean exactamente igual desde la bandeja. Un latido que solo
// suena cuando hay problemas no es un latido.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildSystemAudit, renderSystemAudit } = require('../src/monitoring/system-audit');

const llamada = (turnos, opts = {}) => ({
  status: opts.status || 'ended',
  turn_count: turnos,
  metrics: { turns: (opts.firstAudio || []).map(ms => ({ firstAudioMs: ms })), quality: { fragmentGaps: opts.gaps || 0 } },
});
const sanas = (n) => Array.from({ length: n }, () => llamada(4, { firstAudio: [600, 650, 700, 680] }));

describe('buildSystemAudit — severidad', () => {
  test('todo bien → ok, y aun así hay informe que enviar', () => {
    const r = buildSystemAudit({ llamadas: sanas(10), esquema: [], entorno: [], version: { sha: 'abc1234', telnyxSignature: 'enforced' } });
    assert.strictEqual(r.severidad, 'ok');
    assert.strictEqual(r.resumen, 'todo en orden');
    assert.ok(r.lineas.length > 0, 'un informe vacío no sirve de latido');
  });

  test('una pieza CRÍTICA del esquema manda sobre todo lo demás', () => {
    const r = buildSystemAudit({
      llamadas: sanas(10),
      esquema: [{ pieza: 'nf_calls.ai_decisions', ok: false, critico: true, rompe: 'se pierden TODAS las llamadas' }],
    });
    assert.strictEqual(r.severidad, 'critico');
    assert.match(r.lineas[0].detalle, /se pierden TODAS/);
  });

  test('una pieza opcional es aviso, no crítico', () => {
    const r = buildSystemAudit({ llamadas: sanas(10), esquema: [{ pieza: 'nf_appointments.staff', ok: false, critico: false, rompe: 'x' }] });
    assert.strictEqual(r.severidad, 'aviso');
  });

  test('una variable crítica ausente es crítico (ahí se cuela el dinero)', () => {
    const r = buildSystemAudit({
      llamadas: sanas(10),
      entorno: [{ nombre: 'STRIPE_OVERAGE_METER_EVENT', ok: false, rompe: 'el excedente SE CUENTA Y NO SE COBRA' }],
    });
    assert.strictEqual(r.severidad, 'critico');
    assert.match(r.lineas.find(l => l.nivel === 'critico').detalle, /NO SE COBRA/);
  });
});

describe('buildSystemAudit — lo que percibe el cliente', () => {
  test('un p95 alto se avisa, con la mediana al lado para no asustar de más', () => {
    const lentas = [llamada(3, { firstAudio: [700, 800, 4200] })];
    const r = buildSystemAudit({ llamadas: lentas });
    const aviso = r.lineas.find(l => l.nivel === 'aviso' && /lento/.test(l.titulo));
    assert.ok(aviso, 'debería avisar de la latencia');
    assert.match(aviso.detalle, /mediana/);
    assert.match(aviso.detalle, /objetivo <700/);
  });

  test('latencia sana → línea informativa, no aviso', () => {
    const r = buildSystemAudit({ llamadas: sanas(5) });
    assert.ok(!r.lineas.some(l => l.nivel === 'aviso' && /lento/.test(l.titulo)));
  });

  test('1 de cada 5 llamadas entrecortadas se avisa', () => {
    const l = [...sanas(4), llamada(4, { firstAudio: [600], gaps: 2 })];
    const r = buildSystemAudit({ llamadas: l });
    assert.ok(r.lineas.some(x => /entrecortan/.test(x.titulo)));
  });

  test('llamadas rotas por encima del 25% es CRÍTICO', () => {
    const l = [...sanas(5), llamada(0), llamada(0), llamada(0)];
    const r = buildSystemAudit({ llamadas: l });
    assert.strictEqual(r.severidad, 'critico');
    assert.ok(r.lineas.some(x => /llamadas rotas/.test(x.titulo)));
  });

  test('sin llamadas avisa, pero admite que puede ser normal', () => {
    const r = buildSystemAudit({ llamadas: [] });
    const aviso = r.lineas.find(l => l.nivel === 'aviso');
    assert.match(aviso.detalle, /puede ser normal/);
  });
});

describe('buildSystemAudit — protecciones', () => {
  test('la firma de Telnyx sin exigir es CRÍTICO y se explica el riesgo', () => {
    const r = buildSystemAudit({ llamadas: sanas(5), version: { telnyxSignature: 'UNVERIFIED' } });
    assert.strictEqual(r.severidad, 'critico');
    assert.match(r.lineas.find(l => /firma/.test(l.titulo)).detalle, /a tu costa/);
  });

  test('con la firma exigida no se queja', () => {
    const r = buildSystemAudit({ llamadas: sanas(5), version: { telnyxSignature: 'enforced', sha: 'abc1234' } });
    assert.ok(!r.lineas.some(l => /firma/.test(l.titulo)));
  });

  test('entrada vacía no revienta', () => {
    assert.doesNotThrow(() => buildSystemAudit());
    assert.doesNotThrow(() => buildSystemAudit({}));
  });
});

describe('renderSystemAudit', () => {
  test('deja claro que la AUSENCIA del correo es la señal', () => {
    const html = renderSystemAudit(buildSystemAudit({ llamadas: sanas(3) }));
    assert.match(html, /Si un día no llega/);
    assert.match(html, /TODAS las mañanas/);
  });

  test('pinta todas las líneas del informe', () => {
    const r = buildSystemAudit({ llamadas: sanas(3), version: { sha: 'abc1234' } });
    const html = renderSystemAudit(r);
    for (const l of r.lineas) assert.ok(html.includes(l.titulo), `falta la línea: ${l.titulo}`);
  });
});
