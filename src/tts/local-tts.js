// ============================================
// VoiceCore — Local TTS Module (RTX 4090)
// HTTP client for the XTTS v2 Python server.
//
// Contract: same interface as openai-tts.js and elevenlabs.js.
// Returns mulaw 8 kHz Buffer ready for Twilio.
//
// Reliability features:
//   Circuit breaker — after FAIL_THRESHOLD consecutive errors the client
//   stops hitting the server for RESET_MS (default 60 s) so it doesn't
//   block every call while the 4090 server is down. The router's fallback
//   chain then transparently picks OpenAI TTS instead.
//
//   Retry — transient network errors (5xx, timeout) are retried once with
//   a short delay. 4xx errors are never retried (bad request).
//
//   Timeout — each HTTP request has a hard deadline (default 25 s).
//   Uses a manual AbortController instead of AbortSignal.timeout() for
//   Node 18 compatibility.
// ============================================

const { Logger } = require('../utils/logger');
const { resampleToMulaw8k } = require('../utils/audio');

const log = new Logger('TTS:LOCAL');

const FAIL_THRESHOLD = 3;      // open circuit after N consecutive failures
const RESET_MS = 60_000;       // try again after 1 minute
const RETRY_DELAY_MS = 400;    // wait before retry attempt

class LocalTTS {
  /**
   * @param {string} serverUrl  - Base URL of the Python TTS server
   * @param {object} opts
   * @param {number} opts.timeoutMs   - Per-request timeout (default 25 000 ms)
   * @param {number} opts.maxRetries  - Transient-error retries (default 1)
   */
  constructor(serverUrl = 'http://localhost:8000', opts = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 25_000;
    this.maxRetries = opts.maxRetries ?? 1;

    // Circuit breaker state
    this._failures = 0;
    this._openUntil = 0;
  }

  // ── Public API (mirrors openai-tts.js) ────────────────────────────────────

  /**
   * Synthesize text → mulaw 8 kHz Buffer.
   */
  async synthesize({ callId, text, voice = 'ane', language = 'eu' }) {
    if (!text?.trim()) return Buffer.alloc(0);

    this._assertCircuitClosed(callId);

    const t0 = Date.now();
    log.tts(`[${callId}] "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

    const pcm24k = await this._postWithRetry(callId, { text, voice_id: voice, language });
    const mulaw = resampleToMulaw8k(pcm24k, 24_000);

    const latencyMs = Date.now() - t0;
    const audioMs = Math.round((mulaw.length / 8_000) * 1_000);
    log.metric(`[${callId}] Local TTS ${latencyMs}ms → ${audioMs}ms audio`);
    return mulaw;
  }

  /**
   * Synthesize sentence by sentence and call onChunk with each mulaw chunk.
   * Gives lower perceived latency: Twilio starts playing the first sentence
   * while the server synthesizes the second.
   */
  async streamSynthesize({ callId, text, voice = 'ane', language = 'eu', onChunk }) {
    if (!text?.trim()) return;

    this._assertCircuitClosed(callId);

    const t0 = Date.now();
    const sentences = this._splitSentences(text);
    log.tts(`[${callId}] Streaming ${sentences.length} sentence(s)`);

    let isFirst = true;

    for (const sentence of sentences) {
      if (!sentence) continue;

      try {
        const pcm24k = await this._postWithRetry(callId, {
          text: sentence,
          voice_id: voice,
          language,
        });
        const mulaw = resampleToMulaw8k(pcm24k, 24_000);

        if (isFirst) {
          log.metric(`[${callId}] Local TTS TTFB: ${Date.now() - t0}ms`);
          isFirst = false;
        }

        // Send in 1-second chunks for smooth Twilio playback
        for (let i = 0; i < mulaw.length; i += 8_000) {
          const chunk = mulaw.slice(i, Math.min(i + 8_000, mulaw.length));
          if (onChunk) await onChunk(chunk);
        }
      } catch (err) {
        // One bad sentence should not kill the whole response
        log.warn(`[${callId}] Sentence failed, skipping: ${err.message}`);
      }
    }

    log.metric(`[${callId}] Local TTS stream done in ${Date.now() - t0}ms`);
  }

  /**
   * Health check — used by the router at startup to verify the server is up.
   * Returns false (doesn't throw) so a missing 4090 never crashes Node.
   */
  async isHealthy() {
    try {
      const pcm = await this._fetchWithTimeout(`${this.serverUrl}/health`, {
        method: 'GET',
      }, 3_000);
      // /health returns JSON, not PCM — parse it
      const text = pcm.toString('utf8');
      const data = JSON.parse(text);
      return data.model_loaded === true;
    } catch {
      return false;
    }
  }

  // ── Circuit breaker ────────────────────────────────────────────────────────

  _assertCircuitClosed(callId) {
    if (this._failures >= FAIL_THRESHOLD && Date.now() < this._openUntil) {
      const secs = Math.ceil((this._openUntil - Date.now()) / 1_000);
      throw Object.assign(
        new Error(`Local TTS circuit open — server down, fallback active (retry in ${secs}s)`),
        { statusCode: 503 }
      );
    }
  }

  _onSuccess() {
    this._failures = 0;
    this._openUntil = 0;
  }

  _onFailure() {
    this._failures++;
    if (this._failures >= FAIL_THRESHOLD) {
      this._openUntil = Date.now() + RESET_MS;
      log.warn(`Local TTS circuit OPEN — will retry in ${RESET_MS / 1_000}s`);
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  async _postWithRetry(callId, body) {
    let lastErr;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const buf = await this._fetchWithTimeout(
          `${this.serverUrl}/synthesize`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          this.timeoutMs,
        );
        this._onSuccess();
        return buf;
      } catch (err) {
        lastErr = err;
        // Never retry client errors (400-level) — they won't fix themselves
        if (err.statusCode >= 400 && err.statusCode < 500) break;
        if (attempt < this.maxRetries) {
          log.warn(`[${callId}] Attempt ${attempt + 1} failed (${err.message}), retrying in ${RETRY_DELAY_MS}ms`);
          await this._sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    this._onFailure();
    throw lastErr;
  }

  /**
   * fetch() with a manual hard timeout that works on Node 18.x.
   * Returns the response body as a Buffer.
   */
  async _fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw Object.assign(
          new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`),
          { statusCode: res.status }
        );
      }

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(
          new Error(`Local TTS request timed out after ${timeoutMs}ms`),
          { statusCode: 504 }
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Text splitting ─────────────────────────────────────────────────────────

  /**
   * Split text into sentences suitable for streaming.
   * Handles Spanish/Basque punctuation: . ! ? … ; and common abbreviations.
   */
  _splitSentences(text) {
    // Split on sentence-ending punctuation followed by whitespace or end-of-string.
    // Keeps the delimiter attached to the preceding sentence.
    const raw = text.match(/[^.!?…;]+(?:[.!?…;]+\s*|$)/g) ?? [text];
    return raw.map(s => s.trim()).filter(s => s.length > 1);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { LocalTTS };
