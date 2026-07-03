// ============================================================
// NodeFlow — Tests de la captura de audio para depurar STT
// Caso real: llamadas con transcripción basura y 15s de habla
// perdidos. La captura (STT_DEBUG=1) guarda el ulaw exacto que
// recibió el servidor para poder reproducirlo y separar
// "el audio llega mal" de "nosotros perdemos frames".
// ============================================================
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const sttDebug = require('../src/utils/stt-debug');
const DIR = path.join(os.tmpdir(), 'nf-stt-debug');

function cleanDir() {
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
}

describe('stt-debug — apagado por defecto', () => {
  beforeEach(() => { delete process.env.STT_DEBUG; cleanDir(); });

  test('capture/finalize no hacen nada sin STT_DEBUG=1', () => {
    sttDebug.capture('call-off', Buffer.alloc(8000));
    const file = sttDebug.finalize('call-off');
    assert.strictEqual(file, null);
    assert.strictEqual(sttDebug.enabled(), false);
  });
});

describe('stt-debug — activado', () => {
  beforeEach(() => { process.env.STT_DEBUG = '1'; cleanDir(); });
  afterEach(() => { delete process.env.STT_DEBUG; cleanDir(); });

  test('captura frames y los vuelca al finalizar', () => {
    sttDebug.capture('call-1', Buffer.alloc(8000, 1));
    sttDebug.capture('call-1', Buffer.alloc(4000, 2));
    const file = sttDebug.finalize('call-1');
    assert.ok(file, 'debe devolver la ruta del volcado');
    assert.strictEqual(fs.statSync(file).size, 12000);
  });

  test('respeta el cap de memoria por llamada (5 min)', () => {
    const big = Buffer.alloc(sttDebug.MAX_BYTES_PER_CALL);
    sttDebug.capture('call-cap', big);
    sttDebug.capture('call-cap', Buffer.alloc(8000)); // por encima del cap: se ignora
    const file = sttDebug.finalize('call-cap');
    assert.strictEqual(fs.statSync(file).size, sttDebug.MAX_BYTES_PER_CALL);
  });

  test('rotación: solo quedan las últimas MAX_FILES capturas', () => {
    for (let i = 0; i < sttDebug.MAX_FILES + 2; i++) {
      sttDebug.capture(`call-rot-${i}`, Buffer.alloc(100));
      sttDebug.finalize(`call-rot-${i}`);
    }
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ulaw'));
    assert.strictEqual(files.length, sttDebug.MAX_FILES);
  });

  test('list() reporta segundos de audio (bytes/8000)', () => {
    sttDebug.capture('call-list', Buffer.alloc(16000));
    sttDebug.finalize('call-list');
    const entry = sttDebug.list().find(e => e.callId === 'call-list');
    assert.ok(entry);
    assert.strictEqual(entry.seconds, 2);
  });

  test('getPath sanea el callId (sin path traversal)', () => {
    assert.strictEqual(sttDebug.getPath('../../etc/passwd'), null);
  });

  test('finalize de llamada sin frames no crea archivo', () => {
    assert.strictEqual(sttDebug.finalize('call-nunca-visto'), null);
  });
});
