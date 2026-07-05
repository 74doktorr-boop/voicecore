// ============================================================
// NodeFlow — AssistantManager.getByPhoneNumber
// Multi-tenant: el número LLAMADO (E.164 de la telefonía) debe resolver al
// negocio correcto sea cual sea el formato en que esté guardado el config.
// Antes se mantenía el prefijo 34 → un número guardado sin país no casaba con
// el E.164 y caía al asistente por DEFECTO = contestaba el negocio equivocado.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { AssistantManager } = require('../src/assistants/manager');

function mgr() {
  const m = new AssistantManager('/tmp/nf-test-assistants-nonexistent');
  m.assistants.set('default', { id: 'default', phoneNumber: '000000000' });
  m.assistants.set('biz-a', { id: 'biz-a', phoneNumber: '+34 843 98 76 54' });
  m.assistants.set('biz-b', { id: 'biz-b', phoneNumber: '+34600112233', phoneNumbers: ['+34 611 22 33 44'] });
  return m;
}

describe('getByPhoneNumber — tolerante al formato del número', () => {
  const m = mgr();
  // El mismo número de biz-a en todos los formatos que puede mandar el proveedor
  const formats = ['34843987654', '843987654', '+34843987654', '0034843987654', '+34 843 98 76 54', '843 98 76 54'];
  for (const f of formats) {
    test(`"${f}" → biz-a`, () => assert.strictEqual(m.getByPhoneNumber(f).id, 'biz-a'));
  }

  test('resuelve por número secundario (phoneNumbers[])', () => {
    assert.strictEqual(m.getByPhoneNumber('611223344').id, 'biz-b');
    assert.strictEqual(m.getByPhoneNumber('34600112233').id, 'biz-b');
  });

  test('número desconocido → asistente por defecto (no contesta otro negocio)', () => {
    assert.strictEqual(m.getByPhoneNumber('999888777').id, 'default');
  });
});
