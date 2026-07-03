// ============================================================
// NodeFlow — Tests del traductor org → scheduler
// El caso real (Peluquería HHR, 2026-07-03): el portal guardó
// schedule {mon:{...}, fri:null} y services "solo corte de pelo"
// (texto libre); el scheduler indexa días 0-6 y espera services
// como array. Resultado: "no puedo ofrecerte una cita" a TODO.
// Además, nada rehidrataba las agendas tras un deploy.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  toSchedulerConfig, hydrateSchedulerFromDB, normalizeSchedule,
  parseDurationMinutes, parsePriceEuros, DEFAULT_SCHEDULE,
} = require('../src/scheduling/org-config');

// La fila REAL de la org HHR tal y como está en producción
const HHR = {
  id: '74746a30-02c2-474f-8a47-7a0a716b45d1',
  name: 'Peluquería HHR',
  assistant_config: {
    schedule: {
      fri: null, mon: { open: '09:00', close: '14:00' }, sat: null, sun: null,
      thu: null, tue: { open: '09:00', close: '14:00' }, wed: { open: '09:00', close: '14:00' },
    },
    services: 'solo corte de pelo',
    assistantName: '',
  },
  automation_config: {
    config: {
      serviceList: [
        { name: 'Corte de pelo', notes: 'incluye lavado y peinado', price: '15€', duration: '30 min' },
        { name: 'Tinte completo', notes: '', price: '45€', duration: '90 min' },
        { name: 'Mechas', notes: 'consulta de color gratis', price: '60€', duration: '120 min' },
      ],
    },
  },
};

describe('toSchedulerConfig — el caso HHR real', () => {
  const cfg = toSchedulerConfig(HHR);

  test('el horario pasa de {mon,tue,wed} a días numéricos {1,2,3}', () => {
    assert.deepStrictEqual(Object.keys(cfg.schedule).sort(), ['1', '2', '3']);
    assert.deepStrictEqual(cfg.schedule[1], { open: '09:00', close: '14:00' });
  });

  test('viernes null = cerrado (no aparece)', () => {
    assert.strictEqual(cfg.schedule[5], undefined);
  });

  test('services sale del serviceList estructurado, con duración en minutos', () => {
    assert.strictEqual(cfg.services.length, 3);
    const corte = cfg.services.find(s => s.name === 'Corte de pelo');
    assert.strictEqual(corte.duration, 30);
    assert.strictEqual(cfg.services.find(s => s.name === 'Mechas').duration, 120);
  });

  test('el scheduler REAL da huecos un miércoles y ninguno un viernes', () => {
    const { scheduler } = require('../src/scheduling/scheduler');
    scheduler.setBusinessConfig(HHR.id, cfg);
    // Próximo miércoles y viernes a partir de mañana (evita el filtro de "hoy")
    const next = (dow) => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    };
    const wed = scheduler.getAvailableSlots(HHR.id, next(3), next(3), 'Corte de pelo');
    assert.ok(wed.totalSlots > 0, `miércoles debe tener huecos: ${JSON.stringify(wed).slice(0, 120)}`);
    const fri = scheduler.getAvailableSlots(HHR.id, next(5), next(5), 'Corte de pelo');
    assert.strictEqual(fri.totalSlots, 0, 'viernes está cerrado');
  });
});

describe('toSchedulerConfig — casos límite', () => {
  test('sin schedule → horario comercial por defecto (nunca "not configured")', () => {
    const cfg = toSchedulerConfig({ id: 'x', name: 'Bar Test', assistant_config: {} });
    assert.deepStrictEqual(cfg.schedule, DEFAULT_SCHEDULE);
  });

  test('services texto libre → un servicio genérico de 30 min', () => {
    const cfg = toSchedulerConfig({ id: 'x', assistant_config: { services: 'cortes y tintes' } });
    assert.deepStrictEqual(cfg.services, [{ id: 'general', name: 'Servicio', duration: 30 }]);
  });

  test('schedule ya numérico pasa tal cual (portal futuro)', () => {
    const s = normalizeSchedule({ 2: { open: '10:00', close: '20:00' } });
    assert.deepStrictEqual(s[2], { open: '10:00', close: '20:00' });
  });

  test('turno de tarde se conserva', () => {
    const s = normalizeSchedule({ tue: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '20:00' } });
    assert.deepStrictEqual(s[2], { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '20:00' });
  });

  test('org nula o vacía no lanza', () => {
    assert.doesNotThrow(() => toSchedulerConfig(null));
    assert.doesNotThrow(() => toSchedulerConfig({}));
  });
});

describe('parsePriceEuros — el bug de APT-1002', () => {
  // "15€" como string llegó hasta la columna NUMERIC de nf_appointments:
  // insert rechazado → la cita del cliente solo existía en memoria.
  const cases = [
    ['15€', 15], ['45€', 45], ['60€', 60], ['12,50€', 12.5], ['15 euros', 15],
    [15, 15], [0, 0], ['consultar', null], ['', null], [null, null],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parsePriceEuros(input), expected));
  }

  test('el serviceList real de HHR produce precios numéricos', () => {
    const cfg = toSchedulerConfig(HHR);
    for (const s of cfg.services) {
      assert.ok(s.price === null || typeof s.price === 'number', `${s.name}: price debe ser número o null, es ${typeof s.price}`);
    }
    assert.strictEqual(cfg.services.find(s => s.name === 'Corte de pelo').price, 15);
  });
});

describe('parseServicesText — la edición del dueño ES la verdad', () => {
  const { parseServicesText } = require('../src/scheduling/org-config');

  test('líneas con precio y duración se estructuran', () => {
    const sl = parseServicesText('Corte de pelo 15€ 30 min\nTinte completo 45€');
    assert.strictEqual(sl.length, 2);
    assert.strictEqual(sl[0].name, 'Corte de pelo');
    assert.strictEqual(sl[0].price, '15€');
    assert.match(sl[0].duration, /30\s*min/);
    assert.strictEqual(sl[1].name, 'Tinte completo');
    assert.strictEqual(sl[1].price, '45€');
    assert.strictEqual(sl[1].duration, undefined);
  });

  test('texto sin precios queda como servicio con solo nombre', () => {
    assert.deepStrictEqual(parseServicesText('asesoría fiscal para autónomos'), [{ name: 'asesoría fiscal para autónomos' }]);
  });

  test('precio con coma y "euros" hablado', () => {
    const sl = parseServicesText('Manicura 12,50 euros');
    assert.strictEqual(sl[0].price, '12.50€');
  });

  test('vacío → null; array (UI estructurada futura) pasa normalizado', () => {
    assert.strictEqual(parseServicesText(''), null);
    assert.strictEqual(parseServicesText(null), null);
    assert.deepStrictEqual(parseServicesText([{ name: 'X', price: '5€' }, 'Y']), [{ name: 'X', price: '5€' }, { name: 'Y' }]);
  });
});

describe('parseDurationMinutes', () => {
  const cases = [
    ['30 min', 30], ['90 min', 90], ['120 min', 120],
    ['1h', 60], ['1h 30 min', 90], ['2 horas', 120],
    [45, 45], ['45', 45], ['', 30], [null, 30], ['un rato', 30],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parseDurationMinutes(input), expected));
  }
});

describe('hydrateSchedulerFromDB', () => {
  function fakeDb(rows, error = null) {
    return {
      enabled: true,
      client: { from: () => ({ select: async () => ({ data: rows, error }) }) },
    };
  }

  test('registra todas las orgs en el scheduler', async () => {
    const registered = new Map();
    const fakeScheduler = { setBusinessConfig: (id, cfg) => registered.set(id, cfg) };
    const n = await hydrateSchedulerFromDB({ db: fakeDb([HHR, { id: 'otra', name: 'Otra' }]), scheduler: fakeScheduler });
    assert.strictEqual(n, 2);
    assert.ok(registered.get(HHR.id).schedule[3]);
  });

  test('db deshabilitada → 0 sin lanzar', async () => {
    const n = await hydrateSchedulerFromDB({ db: { enabled: false }, scheduler: {} });
    assert.strictEqual(n, 0);
  });

  test('error de BD se propaga (el arranque lo loguea)', async () => {
    await assert.rejects(
      () => hydrateSchedulerFromDB({ db: fakeDb(null, { message: 'boom' }), scheduler: {} }),
      /boom/
    );
  });
});
