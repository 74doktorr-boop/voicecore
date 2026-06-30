// ============================================
// VoiceCore — Knowledge Base (RAG) — por negocio (org), persistido en Supabase
// Ingesta de texto + recuperación por similitud (coseno en JS).
// Persiste en tabla `knowledge_chunks` (ver db/schema-migration-knowledge.sql).
// Fallback en memoria si la BD no está disponible (dev/tests).
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');

const log = new Logger('KNOWLEDGE');

class KnowledgeBase {
  constructor(config = {}) {
    this.openaiApiKey   = config.openaiApiKey || process.env.OPENAI_API_KEY;
    this.embeddingModel = 'text-embedding-3-small';
    this.chunkSize      = 220;   // palabras por chunk
    this.chunkOverlap   = 40;
    this.topK           = 3;
    this.minScore       = 0.30;
    this._mem           = new Map(); // fallback: orgId -> [{ content, source, embedding }]
  }

  // ── API org-scoped (portal + path de llamada) ────────────────────────

  /** Ingesta texto libre para una org: trocea, vectoriza y persiste. */
  async ingestText(orgId, text, source = 'manual') {
    if (!orgId || !text || !text.trim()) return { chunksAdded: 0 };
    const chunks = this._chunkText(text);
    if (!chunks.length) return { chunksAdded: 0 };

    const embeddings = await this._getEmbeddings(chunks);
    const rows = chunks.map((content, i) => ({ org_id: orgId, content, source, embedding: embeddings[i] }));

    const db = getDatabase();
    if (db.enabled) {
      const { error } = await db.client.from('knowledge_chunks').insert(rows);
      if (error) throw new Error(`KB insert failed: ${error.message}`);
    } else {
      const arr = this._mem.get(orgId) || [];
      for (const r of rows) arr.push({ content: r.content, source: r.source, embedding: r.embedding });
      this._mem.set(orgId, arr);
    }
    log.info(`KB ingest org=${orgId}: +${rows.length} chunks (source: ${source})`);
    return { chunksAdded: rows.length };
  }

  /** Recupera los top-K trozos relevantes para una pregunta. */
  async query(orgId, question, topK) {
    if (!orgId || !question) return [];
    const store = await this._load(orgId);
    if (!store.length) return [];

    const qEmb = (await this._getEmbeddings([question]))[0];
    const scored = store.map(c => ({ content: c.content, source: c.source, score: this._cosine(qEmb, c.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    const k = topK || this.topK;
    return scored.slice(0, k).filter(r => r.score > this.minScore)
      .map(r => ({ text: r.content, source: r.source, score: Math.round(r.score * 1000) / 1000 }));
  }

  /**
   * Contexto listo para inyectar en el prompt del LLM durante una llamada.
   * FAIL-OPEN y acotado en tiempo: si falla o tarda, devuelve '' (la llamada sigue).
   */
  async getContext(orgId, question, { timeoutMs = 1500 } = {}) {
    if (!orgId || !question) return '';
    try {
      const results = await Promise.race([
        this.query(orgId, question),
        new Promise(resolve => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!results || !results.length) return '';
      const body = results.map((r, i) => `[${i + 1}] ${r.text}`).join('\n');
      return `\n\n[INFORMACIÓN DEL NEGOCIO]\n${body}\n\nUsa esta información si es relevante para responder.`;
    } catch (e) {
      log.warn(`KB getContext fail-open org=${orgId}: ${e.message}`);
      return '';
    }
  }

  /**
   * Bloque de conocimiento COMPLETO de la org para inyectar en el system prompt
   * al inicio de la llamada (las KBs de un negocio son pequeñas → caben en contexto,
   * sin recuperación por-turno ni latencia añadida). Acotado y fail-safe ('' si vacío/error).
   */
  async getSystemContext(orgId, maxChars = 3500) {
    if (!orgId) return '';
    try {
      const store = await this._load(orgId);
      if (!store.length) return '';
      let body = '';
      for (const c of store) {
        if (body.length + c.content.length + 2 > maxChars) break;
        body += (body ? '\n' : '') + c.content;
      }
      if (!body) return '';
      return `\n\n[INFORMACIÓN DEL NEGOCIO]\n${body}\n\nUsa esta información para responder con precisión a lo que pregunte el cliente.`;
    } catch (e) {
      log.warn(`KB getSystemContext fail-open org=${orgId}: ${e.message}`);
      return '';
    }
  }

  /** Estadísticas de la KB de una org. */
  async stats(orgId) {
    const store = await this._load(orgId);
    const sources = [...new Set(store.map(c => c.source).filter(Boolean))];
    return { chunks: store.length, sources };
  }

  /** Borra toda la KB de una org. */
  async clear(orgId) {
    const db = getDatabase();
    if (db.enabled) {
      const { error } = await db.client.from('knowledge_chunks').delete().eq('org_id', orgId);
      if (error) throw new Error(`KB clear failed: ${error.message}`);
    } else {
      this._mem.delete(orgId);
    }
    log.info(`KB cleared org=${orgId}`);
    return { ok: true };
  }

  /** Carga los chunks de una org (BD o memoria). */
  async _load(orgId) {
    const db = getDatabase();
    if (db.enabled) {
      const { data, error } = await db.client
        .from('knowledge_chunks').select('content, source, embedding').eq('org_id', orgId).limit(2000);
      if (error) { log.warn(`KB load failed org=${orgId}: ${error.message}`); return []; }
      return data || [];
    }
    return this._mem.get(orgId) || [];
  }

  // ── Compat legacy (routes-extended /api/knowledge/:assistantId/*) ─────
  // La KB es por negocio; el assistantId se ignora para el almacenamiento.
  async ingest(orgId, _assistantId, documents) {
    let added = 0;
    for (const doc of (documents || [])) {
      const r = await this.ingestText(orgId, doc.content || '', doc.title || doc.id || 'doc');
      added += r.chunksAdded;
    }
    return { chunksAdded: added };
  }
  async queryLegacy(orgId, _assistantId, question, topK) { return this.query(orgId, question, topK); }
  async getStats(orgId, _assistantId) { return this.stats(orgId); }
  async deleteStore(orgId, _assistantId) { return this.clear(orgId); }

  // ── Internos ─────────────────────────────────────────────────────────

  _chunkText(text) {
    const words = String(text).split(/\s+/);
    const chunks = [];
    const step = Math.max(1, this.chunkSize - this.chunkOverlap);
    for (let i = 0; i < words.length; i += step) {
      const chunk = words.slice(i, i + this.chunkSize).join(' ').trim();
      if (chunk.length > 20) chunks.push(chunk);
      if (i + this.chunkSize >= words.length) break;
    }
    return chunks;
  }

  async _getEmbeddings(texts) {
    if (!this.openaiApiKey) throw new Error('OpenAI API key required for embeddings');
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: this.embeddingModel }),
    });
    if (!response.ok) throw new Error(`Embeddings error: ${response.status}`);
    const result = await response.json();
    return result.data.map(d => d.embedding);
  }

  _cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom ? dot / denom : 0;
  }
}

let kbInstance = null;
function getKnowledgeBase(config) {
  if (!kbInstance) kbInstance = new KnowledgeBase(config);
  return kbInstance;
}

module.exports = { KnowledgeBase, getKnowledgeBase };
