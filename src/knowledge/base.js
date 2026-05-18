// ============================================
// VoiceCore — Knowledge Base (RAG)
// Document ingestion + retrieval for assistants
// ============================================

const { Logger } = require('../utils/logger');
const crypto = require('crypto');

const log = new Logger('KNOWLEDGE');

class KnowledgeBase {
  constructor(config = {}) {
    this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    this.stores = new Map(); // orgId:assistantId -> { chunks, embeddings }
    this.embeddingModel = 'text-embedding-3-small';
    this.chunkSize = 500;
    this.chunkOverlap = 50;
    this.topK = 3;
  }

  /**
   * Ingest text content into the knowledge base
   */
  async ingest(orgId, assistantId, documents) {
    const storeKey = `${orgId}:${assistantId}`;
    if (!this.stores.has(storeKey)) {
      this.stores.set(storeKey, { chunks: [], embeddings: [] });
    }
    const store = this.stores.get(storeKey);

    for (const doc of documents) {
      const chunks = this._chunkText(doc.content, doc.title || doc.id);
      log.info(`Ingesting ${chunks.length} chunks from "${doc.title || doc.id}"`);

      // Generate embeddings in batches
      const batchSize = 20;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => c.text);
        const embeddings = await this._getEmbeddings(texts);

        for (let j = 0; j < batch.length; j++) {
          store.chunks.push({
            id: crypto.randomUUID(),
            text: batch[j].text,
            source: batch[j].source,
            metadata: { ...doc.metadata, chunkIndex: i + j },
          });
          store.embeddings.push(embeddings[j]);
        }
      }
    }

    log.info(`Store ${storeKey}: ${store.chunks.length} total chunks`);
    return { chunksAdded: documents.reduce((s, d) => s + this._chunkText(d.content).length, 0) };
  }

  /**
   * Query the knowledge base for relevant context
   */
  async query(orgId, assistantId, question, topK) {
    const storeKey = `${orgId}:${assistantId}`;
    const store = this.stores.get(storeKey);
    if (!store || store.chunks.length === 0) return [];

    const k = topK || this.topK;
    const questionEmbedding = (await this._getEmbeddings([question]))[0];

    // Compute cosine similarities
    const scored = store.embeddings.map((emb, idx) => ({
      chunk: store.chunks[idx],
      score: this._cosineSimilarity(questionEmbedding, emb),
    }));

    // Sort by score and return top K
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, k).filter(r => r.score > 0.3);

    log.info(`Query "${question.substring(0, 50)}..." → ${results.length} results (top score: ${results[0]?.score.toFixed(3) || 'N/A'})`);

    return results.map(r => ({
      text: r.chunk.text,
      source: r.chunk.source,
      score: Math.round(r.score * 1000) / 1000,
      metadata: r.chunk.metadata,
    }));
  }

  /**
   * Build RAG context string for LLM prompt injection
   */
  async getContext(orgId, assistantId, question) {
    const results = await this.query(orgId, assistantId, question);
    if (results.length === 0) return '';

    const context = results.map((r, i) =>
      `[Fuente ${i + 1}: ${r.source}]\n${r.text}`
    ).join('\n\n');

    return `\n\n[INFORMACIÓN RELEVANTE]\n${context}\n\nUsa esta información para responder al usuario de forma precisa.`;
  }

  /**
   * Chunk text into overlapping segments
   */
  _chunkText(text, source = 'unknown') {
    const words = text.split(/\s+/);
    const chunks = [];

    for (let i = 0; i < words.length; i += this.chunkSize - this.chunkOverlap) {
      const chunk = words.slice(i, i + this.chunkSize).join(' ');
      if (chunk.trim().length > 20) {
        chunks.push({ text: chunk.trim(), source });
      }
    }

    return chunks;
  }

  /**
   * Get embeddings from OpenAI
   */
  async _getEmbeddings(texts) {
    if (!this.openaiApiKey) throw new Error('OpenAI API key required for embeddings');

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.embeddingModel }),
    });

    if (!response.ok) throw new Error(`Embeddings error: ${response.status}`);
    const result = await response.json();
    return result.data.map(d => d.embedding);
  }

  /**
   * Cosine similarity between two vectors
   */
  _cosineSimilarity(a, b) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Delete a knowledge store
   */
  deleteStore(orgId, assistantId) {
    const key = `${orgId}:${assistantId}`;
    this.stores.delete(key);
    log.info(`Store deleted: ${key}`);
  }

  /**
   * Get store stats
   */
  getStats(orgId, assistantId) {
    const key = `${orgId}:${assistantId}`;
    const store = this.stores.get(key);
    if (!store) return { chunks: 0, sources: [] };

    const sources = [...new Set(store.chunks.map(c => c.source))];
    return { chunks: store.chunks.length, sources };
  }
}

// Singleton
let kbInstance = null;
function getKnowledgeBase(config) {
  if (!kbInstance) kbInstance = new KnowledgeBase(config);
  return kbInstance;
}

module.exports = { KnowledgeBase, getKnowledgeBase };
