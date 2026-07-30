// ============================================================
// NodeFlow — La misma hora, afirmada dos veces con distinta certeza (2026-07-30)
//
// En el alta, `assistant_config` se siembra sin horario, así que el asistente
// reserva contra un calendario por defecto que el dueño no ha visto nunca. Por
// VOZ ya se avisa ("se la dejo anotada y le confirmamos desde el centro"), pero
// el WhatsApp seguía mandando `nodeflow_cita_confirmada`: "tu cita HA SIDO
// CONFIRMADA para el 5 de julio a las 10:00".
//
// No se podía parchear metiendo "(por confirmar)" en el parámetro de la hora:
// el cuerpo aprobado por Meta dice "ha sido confirmada", y habría salido
// "ha sido confirmada ... a las 10:00 (por confirmar)".
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { sendWaConfirmation } = require('../src/notifications/reminders');
const { WA_TEMPLATES } = require('../src/whatsapp/templates');

const APT = { id: 'APT-1', phone: '+34600111222', businessId: 'org-1', date: '2026-08-05', time: '10:00', service: 'Fisioterapia', patientName: 'María Ruiz' };
const CONFIG = { name: 'Centro Osakin', language: 'es' };

function espia({ horario, fallan = [] }) {
  const enviados = [];
  return {
    enviados,
    deps: {
      tieneHorario: async () => horario,
      getWaCredentials: async () => ({ token: 't', phoneNumberId: 'p' }),
      waIsConfigured: () => true,
      optedOut: false,
      sendTemplate: async (_to, name, lang, comps, creds) => {
        enviados.push({ name, lang, comps, propio: !!creds });
        return fallan.includes(name) ? { ok: false, error: 'template not approved' } : { ok: true };
      },
    },
  };
}

describe('la plantilla nueva existe y cumple las reglas de Meta', () => {
  const t = WA_TEMPLATES.find(x => x.name === 'nodeflow_cita_por_confirmar');

  test('está dada de alta en la única fuente de verdad', () => {
    assert.ok(t, 'no está en WA_TEMPLATES: no se daría de alta al conectar un número');
    assert.strictEqual(t.category, 'UTILITY');
  });

  test('ni empieza ni termina en variable (requisito del alta en Meta)', () => {
    const body = t.components.find(c => c.type === 'BODY').text;
    assert.ok(!/^\{\{/.test(body.trim()), 'no puede empezar en variable');
    assert.ok(!/\}\}[.\s]*$/.test(body.trim()), 'no puede terminar en variable');
  });

  test('NO afirma que esté confirmada, y dice que se confirmará', () => {
    const body = t.components.find(c => c.type === 'BODY').text;
    assert.ok(!/ha sido confirmada/i.test(body), 'esa es justo la frase que sobra');
    assert.match(body, /hemos anotado/i);
    assert.match(body, /confirmamos la hora/i);
  });

  test('MISMOS 5 parámetros que la de siempre: el código solo cambia el nombre', () => {
    const otra = WA_TEMPLATES.find(x => x.name === 'nodeflow_cita_confirmada');
    const params = (tpl) => (tpl.components.find(c => c.type === 'BODY').text.match(/\{\{\d\}\}/g) || []);
    assert.deepStrictEqual(params(t), params(otra),
      'si los parámetros no coinciden, cambiar de plantilla desalinea los argumentos');
  });
});

describe('sendWaConfirmation elige plantilla según el horario', () => {
  test('CON horario: la de siempre', async () => {
    const e = espia({ horario: true });
    assert.strictEqual(await sendWaConfirmation(APT, CONFIG, e.deps), true);
    assert.strictEqual(e.enviados[0].name, 'nodeflow_cita_confirmada');
  });

  test('SIN horario: la que no afirma la hora', async () => {
    const e = espia({ horario: false });
    assert.strictEqual(await sendWaConfirmation(APT, CONFIG, e.deps), true);
    assert.strictEqual(e.enviados[0].name, 'nodeflow_cita_por_confirmar');
  });

  test('los 5 parámetros viajan igual con una plantilla que con la otra', async () => {
    const con = espia({ horario: true }), sin = espia({ horario: false });
    await sendWaConfirmation(APT, CONFIG, con.deps);
    await sendWaConfirmation(APT, CONFIG, sin.deps);
    assert.deepStrictEqual(sin.enviados[0].comps, con.enviados[0].comps);
  });
});

describe('mientras Meta la revisa, nadie se queda sin aviso', () => {
  test('si la nueva no está aprobada, cae a la de siempre', async () => {
    // Quedarse sin aviso es peor que un aviso demasiado rotundo.
    const e = espia({ horario: false, fallan: ['nodeflow_cita_por_confirmar'] });
    assert.strictEqual(await sendWaConfirmation(APT, CONFIG, e.deps), true);
    assert.deepStrictEqual(e.enviados.map(x => x.name),
      ['nodeflow_cita_por_confirmar', 'nodeflow_cita_confirmada']);
  });

  test('NUNCA al revés: con horario jamás se manda la de "por confirmar"', async () => {
    const e = espia({ horario: true, fallan: ['nodeflow_cita_confirmada'] });
    await sendWaConfirmation(APT, CONFIG, e.deps);
    assert.ok(!e.enviados.some(x => x.name === 'nodeflow_cita_por_confirmar'),
      'sembraría duda sobre una hora que sí es firme');
  });

  test('si no se puede saber el horario, la cita se confirma igual', async () => {
    // Encontrado por este test: la consulta estaba FUERA del try, así que un
    // fallo de BD al leer una PREFERENCIA sobre el texto se llevaba por delante
    // la confirmación de una cita ya reservada.
    const e = espia({ horario: true });
    e.deps.tieneHorario = async () => { throw new Error('BD caída'); };
    assert.strictEqual(await sendWaConfirmation(APT, CONFIG, e.deps), true);
    assert.strictEqual(e.enviados[0].name, 'nodeflow_cita_confirmada');
  });
});
