// ============================================================
// NodeFlow — Seguimientos personalizados (2026-07-06)
// El sistema sugiere candidatos (quien llamó y no reservó) + redacta
// un mensaje personalizado; el dueño lo envía por su WhatsApp.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { draftMessage, getCandidates, markDone, dedupeCalls, followupKind, truncateSafe } = require('../src/lifecycle/followups');

// ── Stub mínimo del cliente Supabase (encadenable) ──────────
function stubDb({ calls = [], contacts = [], callRow = null, onUpdate, onOr } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        const rows = table === 'contacts' ? contacts : calls;
        const q = {
          _rows: rows,
          select() { return q; },
          eq() { return q; },
          gte() { return q; },
          neq() { return q; },
          or(expr) { if (onOr) onOr(expr); return q; },
          in() { return q; },
          order() { return q; },
          limit() { return Promise.resolve({ data: q._rows }); },
          maybeSingle() { return Promise.resolve({ data: callRow, error: null }); },
          update(patch) {
            if (onUpdate) onUpdate(table, patch);
            return { eq() { return { eq() { return Promise.resolve({ error: null }); } }; } };
          },
          then(resolve) { return Promise.resolve({ data: q._rows }).then(resolve); },
        };
        return q;
      },
    },
  };
}

describe('draftMessage (pura)', () => {
  test('usa el nombre de pila cuando existe', () => {
    const m = draftMessage({ name: 'María López', reason: 'info', bizName: 'Clínica Osakin' });
    assert.match(m, /Hola María/);
    assert.match(m, /Soy Clínica Osakin\./);
  });

  test('sin nombre → saludo genérico, sin "undefined"', () => {
    const m = draftMessage({ reason: 'info', bizName: 'X' });
    assert.match(m, /^Hola,/);
    assert.doesNotMatch(m, /undefined/);
  });

  test('se presenta como «Soy [asistente] de [negocio]», no «Soy [negocio]»', () => {
    const m = draftMessage({ name: 'María', reason: 'info', bizName: 'Fisioterapia Unai', assistantName: 'Laura' });
    assert.match(m, /Soy Laura de Fisioterapia Unai\./);
    assert.doesNotMatch(m, /Soy Fisioterapia Unai\./);
  });

  test('sin nombre de asistente → cae al formato anterior (solo negocio)', () => {
    const m = draftMessage({ name: 'María', reason: 'info', bizName: 'Fisioterapia Unai' });
    assert.match(m, /Soy Fisioterapia Unai\./);
  });

  test('gallego con asistente: «Son [asistente] de [negocio]»', () => {
    const m = draftMessage({ reason: 'info', bizName: 'Clínica Mareas', assistantName: 'Antía', lang: 'gl' });
    assert.match(m, /Son Antía de Clínica Mareas\./);
  });

  test('callback_requested habla de agendar', () => {
    assert.match(draftMessage({ reason: 'callback_requested' }), /agend/i);
  });

  test('abandoned menciona el corte de la llamada', () => {
    assert.match(draftMessage({ reason: 'abandoned' }), /cort/i);
  });

  test('reason desconocido cae al mensaje de consulta', () => {
    assert.match(draftMessage({ reason: 'zzz' }), /consultaste/i);
  });

  test('gallego: saludo e identidad en galego (también es+gl)', () => {
    const m = draftMessage({ name: 'Brais Castro', reason: 'info', bizName: 'Clínica Mareas', lang: 'gl' });
    assert.match(m, /^Ola Brais/);
    assert.match(m, /Son Clínica Mareas\./);
    const bi = draftMessage({ reason: 'abandoned', lang: 'es+gl' });
    assert.match(bi, /^Ola/);
    assert.match(bi, /chamada/);
  });

  test('euskera: saludo e identidad en euskara', () => {
    const m = draftMessage({ name: 'Aitor', reason: 'callback_requested', bizName: 'Osakin', lang: 'eu' });
    assert.match(m, /^Kaixo Aitor/);
    assert.match(m, /Osakin naiz\./);
  });

  test('idioma desconocido cae a castellano', () => {
    assert.match(draftMessage({ reason: 'info', lang: 'fr' }), /^Hola/);
  });
});

describe('dedupeCalls (pura) — una sugerencia por contacto y motivo', () => {
  const call = (id, phone, outcome, at, metrics) =>
    ({ id, caller_number: phone, outcome, started_at: at, metrics: metrics || {} });

  test('tres llamadas del mismo contacto y motivo → UNA tarjeta, gana la más reciente', () => {
    // Bug 2026-07-08: "Raúl · Consultó, no reservó" ×3 (hoy/ayer/ayer).
    const out = dedupeCalls([
      call('c-hoy',   '+34600111222', 'info', '2026-07-08T10:00:00Z'),
      call('c-ayer1', '600111222',    'info', '2026-07-07T18:00:00Z'),   // variante nacional
      call('c-ayer2', '34600111222',  null,   '2026-07-07T09:00:00Z'),   // NULL cae a 'info'
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 'c-hoy');   // la última llamada manda (y su fecha)
  });

  test('motivos distintos del mismo contacto conviven (consultó + se cortó)', () => {
    const out = dedupeCalls([
      call('c1', '+34600111222', 'info',      '2026-07-08T10:00:00Z'),
      call('c2', '+34600111222', 'abandoned', '2026-07-07T10:00:00Z'),
    ]);
    assert.strictEqual(out.length, 2);
  });

  test('contactos distintos no se mezclan aunque compartan motivo', () => {
    const out = dedupeCalls([
      call('c1', '+34600111222', 'info', '2026-07-08T10:00:00Z'),
      call('c2', '+34600333444', 'info', '2026-07-08T11:00:00Z'),
    ]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].id, 'c2');   // orden: más recientes primero
  });

  test('seguir al contacto silencia también sus llamadas hermanas anteriores', () => {
    // El dueño siguió a Raúl por la llamada de hoy → la de ayer NO resucita.
    const out = dedupeCalls([
      call('c-hoy',  '+34600111222', 'info', '2026-07-08T10:00:00Z',
        { followup: { done: true, at: '2026-07-08T12:00:00Z' } }),
      call('c-ayer', '600111222',    'info', '2026-07-07T10:00:00Z'),
    ]);
    assert.strictEqual(out.length, 0);
  });

  test('una llamada POSTERIOR al seguimiento sí genera sugerencia nueva', () => {
    const out = dedupeCalls([
      call('c-nueva',   '+34600111222', 'info', '2026-07-08T15:00:00Z'),
      call('c-seguida', '+34600111222', 'info', '2026-07-07T10:00:00Z',
        { followup: { done: true, at: '2026-07-07T12:00:00Z' } }),
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 'c-nueva');
  });

  test('followupKind: outcomes raros y null caen a info', () => {
    assert.strictEqual(followupKind('callback_requested'), 'callback_requested');
    assert.strictEqual(followupKind('abandoned'), 'abandoned');
    assert.strictEqual(followupKind(null), 'info');
    assert.strictEqual(followupKind('zzz'), 'info');
  });
});

describe('truncateSafe — el emoji sobrevive al recorte y al enlace wa.me', () => {
  test('recorte que cae en mitad de un emoji no deja suplente huérfano', () => {
    const msg = 'hola 🙂';                       // 🙂 = 2 unidades UTF-16
    const cut = truncateSafe(msg, msg.length - 1); // el corte parte el par
    assert.strictEqual(cut, 'hola ');            // retrocede, no deja media pareja
    assert.doesNotThrow(() => encodeURIComponent(cut)); // .slice a lo bruto lanzaría URIError
  });

  test('sin pasarse del límite el mensaje queda intacto', () => {
    assert.strictEqual(truncateSafe('hola 🙂', 100), 'hola 🙂');
  });

  test('transformación completa: borrador → recorte → URL wa.me → decodificado', () => {
    const draft = draftMessage({ name: 'Raúl', reason: 'info', bizName: 'Taller Beti' });
    assert.match(draft, /🙂/);                   // el borrador acaba en emoji
    const message = truncateSafe(draft.trim(), 1000);           // ruta /send del portal
    const url = 'https://wa.me/34600111222?text=' + encodeURIComponent(message);
    const decoded = decodeURIComponent(url.split('?text=')[1]); // lo que ve WhatsApp
    assert.strictEqual(decoded, draft);
    assert.doesNotMatch(decoded, /�/);      // jamás "�"
  });
});

describe('getCandidates', () => {
  test('sin BD → []', async () => {
    const out = await getCandidates('org1', { db: { enabled: false } });
    assert.deepStrictEqual(out, []);
  });

  test('excluye las ya seguidas (metrics.followup.done) y las de número desconocido', async () => {
    const db = stubDb({
      calls: [
        { id: 'c1', caller_number: '+34600111222', outcome: 'info', started_at: 'x', metrics: {} },
        { id: 'c2', caller_number: '+34600333444', outcome: 'info', started_at: 'x', metrics: { followup: { done: true } } },
        { id: 'c3', caller_number: 'unknown',      outcome: 'info', started_at: 'x', metrics: {} },
      ],
    });
    const out = await getCandidates('org1', { db, bizName: 'Nego' });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].callId, 'c1');
    assert.match(out[0].draft, /Nego/);
  });

  test('NO le afecta el followup_sent del email automático (bandera ajena)', async () => {
    const db = stubDb({
      calls: [{ id: 'c1', caller_number: '+34600111222', outcome: 'info', started_at: 'x', followup_sent: true, metrics: {} }],
    });
    const out = await getCandidates('org1', { db });
    assert.strictEqual(out.length, 1);   // el email automático no es el WhatsApp del dueño
  });

  test('consulta con .or para incluir llamadas con outcome NULL', async () => {
    let orExpr = null;
    const db = stubDb({
      calls: [{ id: 'c1', caller_number: '+34600111222', outcome: null, started_at: 'x', metrics: {} }],
      onOr: (e) => { orExpr = e; },
    });
    const out = await getCandidates('org1', { db });
    assert.match(orExpr, /outcome\.is\.null/);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].reason, 'info');   // sin outcome → mensaje de consulta
  });

  test('resuelve el nombre del contacto por teléfono', async () => {
    const db = stubDb({
      calls:    [{ id: 'c1', caller_number: '+34600111222', outcome: 'callback_requested', started_at: 'x', metrics: { audit: { score: 42 } } }],
      contacts: [{ name: 'Aitor', phone: '+34600111222' }],
    });
    const out = await getCandidates('org1', { db });
    assert.strictEqual(out[0].name, 'Aitor');
    assert.strictEqual(out[0].score, 42);
    assert.match(out[0].draft, /Hola Aitor/);
  });

  test('mismo contacto llamando 3 veces → una sola tarjeta por motivo, con la última fecha', async () => {
    const db = stubDb({
      calls: [
        { id: 'c-hoy', caller_number: '+34600111222', outcome: 'info', started_at: '2026-07-08T10:00:00Z', metrics: {} },
        { id: 'c-ay1', caller_number: '600111222',    outcome: 'info', started_at: '2026-07-07T18:00:00Z', metrics: {} },
        { id: 'c-ay2', caller_number: '34600111222',  outcome: null,   started_at: '2026-07-07T09:00:00Z', metrics: {} },
        { id: 'c-cut', caller_number: '+34600111222', outcome: 'abandoned', started_at: '2026-07-06T09:00:00Z', metrics: {} },
      ],
    });
    const out = await getCandidates('org1', { db });
    assert.strictEqual(out.length, 2);   // "consultó" + "se cortó", nada repetido
    assert.strictEqual(out[0].callId, 'c-hoy');
    assert.strictEqual(out[0].when, '2026-07-08T10:00:00Z');
  });
});

describe('markDone', () => {
  test('escribe metrics.followup.done sin tocar followup_sent (bandera propia)', async () => {
    let captured = null;
    const db = stubDb({ callRow: { metrics: { audit: { score: 80 } } }, onUpdate: (t, patch) => { captured = { t, patch }; } });
    const r = await markDone('c1', 'org1', { db, channel: 'wa_link' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(captured.t, 'nf_calls');
    assert.strictEqual(captured.patch.followup_sent, undefined);          // no pisa la del email
    assert.strictEqual(captured.patch.metrics.followup.done, true);
    assert.strictEqual(captured.patch.metrics.followup.channel, 'wa_link');
    assert.strictEqual(captured.patch.metrics.audit.score, 80);           // conserva el audit
  });

  test('llamada inexistente → ok:false', async () => {
    const db = stubDb({ callRow: null });
    const r = await markDone('c1', 'org1', { db });
    assert.strictEqual(r.ok, false);
  });

  test('sin BD → ok:false', async () => {
    const r = await markDone('c1', 'org1', { db: { enabled: false } });
    assert.strictEqual(r.ok, false);
  });
});
