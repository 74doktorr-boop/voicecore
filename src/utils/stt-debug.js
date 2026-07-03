// ============================================================
// VoiceCore — Captura de audio entrante para depurar el STT
// Caso real (2026-07-03): dos llamadas seguidas al mismo número,
// una transcribe bien y otra devuelve basura con 15s de habla
// perdidos. Para saber si el audio LLEGA mal (red/llamante) o lo
// perdemos NOSOTROS (frames caídos bajo carga), hay que poder
// escuchar exactamente lo que recibió el servidor.
//
// - Apagado por defecto. Se activa con STT_DEBUG=1 (EasyPanel).
// - Guarda el ulaw crudo de las últimas MAX_FILES llamadas en
//   <tmpdir>/nf-stt-debug/. Se recupera vía admin:
//   GET /api/admin/stt-debug            → lista
//   GET /api/admin/stt-debug/:callId    → descarga el .ulaw
//   (reproducir: ffplay -f mulaw -ar 8000 <archivo>)
// - Cap de memoria por llamada (5 min de audio) — nunca crece sin límite.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Logger } = require('./logger');

const log = new Logger('STT-DEBUG');

const MAX_BYTES_PER_CALL = 5 * 60 * 8000; // 5 min de ulaw 8kHz
const MAX_FILES = 3;

const buffers = new Map(); // callId -> { chunks: Buffer[], bytes: number }

function enabled() {
  return process.env.STT_DEBUG === '1';
}

function dir() {
  return path.join(os.tmpdir(), 'nf-stt-debug');
}

/** Acumula un frame de audio entrante (no hace nada si está apagado). */
function capture(callId, buffer) {
  if (!enabled() || !buffer?.length) return;
  let entry = buffers.get(callId);
  if (!entry) { entry = { chunks: [], bytes: 0 }; buffers.set(callId, entry); }
  if (entry.bytes >= MAX_BYTES_PER_CALL) return;
  entry.chunks.push(buffer);
  entry.bytes += buffer.length;
}

/** Al terminar la llamada: vuelca a disco y rota (quedan las MAX_FILES últimas). */
function finalize(callId) {
  const entry = buffers.get(callId);
  buffers.delete(callId);
  if (!enabled() || !entry || entry.bytes === 0) return null;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const file = path.join(dir(), `${callId}.ulaw`);
    fs.writeFileSync(file, Buffer.concat(entry.chunks));
    log.info(`[${callId}] Audio entrante volcado: ${(entry.bytes / 8000).toFixed(1)}s → ${file}`);
    // Rotación: borrar lo más antiguo por encima del cupo
    const files = fs.readdirSync(dir())
      .filter(f => f.endsWith('.ulaw'))
      .map(f => ({ f, t: fs.statSync(path.join(dir(), f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(MAX_FILES)) {
      fs.unlinkSync(path.join(dir(), old.f));
    }
    return file;
  } catch (e) {
    log.warn(`[${callId}] No se pudo volcar el audio de debug: ${e.message}`);
    return null;
  }
}

/** Lista las capturas disponibles. */
function list() {
  try {
    return fs.readdirSync(dir())
      .filter(f => f.endsWith('.ulaw'))
      .map(f => {
        const st = fs.statSync(path.join(dir(), f));
        return { callId: f.replace(/\.ulaw$/, ''), bytes: st.size, seconds: +(st.size / 8000).toFixed(1), mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch { return []; }
}

/** Ruta del archivo de una captura, o null. */
function getPath(callId) {
  const safe = String(callId).replace(/[^\w.-]/g, '');
  const file = path.join(dir(), `${safe}.ulaw`);
  return fs.existsSync(file) ? file : null;
}

module.exports = { capture, finalize, list, getPath, enabled, MAX_BYTES_PER_CALL, MAX_FILES };
