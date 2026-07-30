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

  test('fallos NUESTROS por encima del 25% es CRÍTICO', () => {
    // `llamada(0)` no tiene transcript: la IA no llegó a hablar. Eso sí es
    // culpa nuestra, a diferencia de "el cliente colgó al oír el saludo".
    const l = [...sanas(5), llamada(0), llamada(0), llamada(0)];
    const r = buildSystemAudit({ llamadas: l });
    assert.strictEqual(r.severidad, 'critico');
    assert.ok(r.lineas.some(x => /fallo NUESTRO/.test(x.titulo)), 'debe distinguirlo de que el cliente cuelgue');
  });

  test('el cliente que cuelga al oír el saludo NO cuenta como fallo', () => {
    // Es el caso real que disparó todo esto: la alarma del 18% eran pruebas de
    // madrugada más dos personas que colgaron. Cero averías.
    const colgadas = Array.from({ length: 3 }, () => ({
      status: 'ended', turn_count: 0, duration_ms: 6000,
      transcript: [{ role: 'assistant', content: 'Hola, ha llamado a…' }],
      metrics: { turns: [], quality: {} },
    }));
    const r = buildSystemAudit({ llamadas: [...sanas(5), ...colgadas] });
    assert.notStrictEqual(r.severidad, 'critico');
    assert.ok(r.lineas.some(x => /cuelga al oír el saludo/.test(x.titulo)), 'y la señal de producto sí aparece');
  });

  test('sin llamadas avisa, pero admite que puede ser normal', () => {
    const r = buildSystemAudit({ llamadas: [] });
    const aviso = r.lineas.find(l => l.nivel === 'aviso');
    assert.match(aviso.detalle, /puede ser normal/);
  });
});

describe('buildSystemAudit — altas sin terminar', () => {
  test('un negocio con número y sin horario es CRÍTICO, y se dice el daño', () => {
    // No es "falta un campo": es que reserva citas en un horario inventado
    // mientras la IA tiene prohibido decir cuál es su horario.
    const r = buildSystemAudit({
      llamadas: sanas(5),
      altasIncompletas: [{
        negocio: 'Centro Osakin', gravedad: 'critico',
        faltan: [{ falta: 'sin horario configurado', consecuencia: 'reserva citas en un horario INVENTADO' }],
      }],
    });
    assert.strictEqual(r.severidad, 'critico');
    const l = r.lineas.find(x => /alta está sin terminar/.test(x.titulo));
    assert.match(l.titulo, /Centro Osakin/);
    assert.match(l.detalle, /horario INVENTADO/);
  });

  test('si solo falta lo accesorio, es aviso', () => {
    const r = buildSystemAudit({
      llamadas: sanas(5),
      altasIncompletas: [{ negocio: 'X', gravedad: 'aviso', faltan: [{ falta: 'sin saludo propio', consecuencia: 'fórmula genérica' }] }],
    });
    assert.strictEqual(r.severidad, 'aviso');
  });

  test('sin altas incompletas no dice nada', () => {
    const r = buildSystemAudit({ llamadas: sanas(5), altasIncompletas: [] });
    assert.ok(!r.lineas.some(x => /alta está sin terminar/.test(x.titulo)));
  });
});

describe('buildSystemAudit — números asignados que no reciben nada', () => {
  test('EL CASO OSAKIN: 15 días con número y ni una llamada → aviso', () => {
    // El detector de silencio de client-health exige ≥3 llamadas previas para
    // avisar de que han parado. Un número que NUNCA recibió ninguna le es
    // invisible — y es el caso peor: el cliente cree tener el servicio.
    const r = buildSystemAudit({
      llamadas: sanas(5),
      numerosMudos: [{ numero: '+34843700832', negocio: 'Centro Osakin', diasAsignado: 15 }],
    });
    assert.strictEqual(r.severidad, 'aviso', 'un alta que va lenta no es una avería');
    const l = r.lineas.find(x => /NUNCA una llamada/.test(x.titulo));
    assert.match(l.titulo, /Centro Osakin/);
    assert.match(l.detalle, /15 días/);
    assert.match(l.detalle, /no han desviado su línea/);
  });

  test('pasado el mes sí es CRÍTICO: lleva un mes creyendo que tiene servicio', () => {
    const r = buildSystemAudit({
      llamadas: sanas(5),
      numerosMudos: [{ numero: '+34843700832', negocio: 'Centro Osakin', diasAsignado: 31 }],
    });
    assert.strictEqual(r.severidad, 'critico');
  });

  test('las cuentas internas se excluyen PERO se dicen', () => {
    // Excluirlas en silencio sería tapar la señal: un cliente real con el
    // owner_email mal puesto desaparecería del informe justo por estar mal.
    const r = buildSystemAudit({
      llamadas: sanas(5),
      internasExcluidas: [{ negocio: 'Centro Osakin', email: '74doktorr+metarevisor@gmail.com' }],
    });
    const l = r.lineas.find(x => /cuentas internas/.test(x.titulo));
    assert.ok(l, 'la exclusión tiene que ser visible');
    assert.match(l.detalle, /Centro Osakin/);
    assert.match(l.detalle, /mal el owner_email/);
    assert.strictEqual(r.severidad, 'ok', 'pero no es una alarma');
  });

  test('sin números mudos no dice nada', () => {
    const r = buildSystemAudit({ llamadas: sanas(5), numerosMudos: [] });
    assert.ok(!r.lineas.some(x => /NUNCA una llamada/.test(x.titulo)));
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
