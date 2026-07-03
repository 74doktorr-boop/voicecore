// ============================================
// VoiceCore — Groq LLM (Ultra-Fast Inference)
// Llama 3.3 70B at ~80ms TTFT
// ============================================

const { Logger } = require('../utils/logger');
const { TextualToolFilter } = require('./textual-tool-filter');
const log = new Logger('LLM:GROQ');

class GroqLLM {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.groq.com/openai/v1';
  }

  async *streamCompletion({ callId, messages, model = 'llama-3.3-70b-versatile', tools = null, temperature = 0.7, maxTokens = 500 }) {
    const startTime = Date.now();
    let firstTokenTime = null;
    let totalTokens = 0;

    const body = { model, messages, temperature, max_tokens: maxTokens, stream: true };
    if (tools?.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }

    log.llm(`[${callId}] Groq request`, { model, msgs: messages.length });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`Groq error: ${response.status} ${await response.text()}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentContent = '';
      let toolCalls = [];
      // Llama a veces textualiza los tool calls ("<function=...>{...}")
      // en vez de usar delta.tool_calls — sin este filtro, ese JSON
      // llegaba al TTS y el cliente lo OÍA por teléfono.
      const textualFilter = new TextualToolFilter();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (!firstTokenTime && (delta.content || delta.tool_calls)) {
              firstTokenTime = Date.now();
              log.metric(`[${callId}] Groq TTFT: ${firstTokenTime - startTime}ms`);
            }

            if (delta.content) {
              totalTokens++;
              const safe = textualFilter.push(delta.content);
              if (safe) {
                currentContent += safe;
                yield { type: 'text', content: safe, accumulated: currentContent };
              }
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                if (tc.id) toolCalls[tc.index].id = tc.id;
                if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
              }
            }

            if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
              for (const tc of toolCalls) {
                if (tc.function.name) yield { type: 'tool_call', toolCall: tc };
              }
            }
          } catch (e) { /* skip */ }
        }
      }

      // Cierre del filtro: libera texto retenido inocuo y recupera los
      // tool calls que Llama emitió como texto, como si fueran nativos.
      const tail = textualFilter.finish();
      if (tail.text) {
        currentContent += tail.text;
        yield { type: 'text', content: tail.text, accumulated: currentContent };
      }
      if (tail.toolCalls.length > 0) {
        log.warn(`[${callId}] Llama emitió ${tail.toolCalls.length} tool call(s) como TEXTO — interceptados: ${tail.toolCalls.map(t => t.function.name).join(', ')}`);
        for (const tc of tail.toolCalls) yield { type: 'tool_call', toolCall: tc };
      }

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] Groq completed in ${totalTime}ms (~${totalTokens} tokens)`);

      yield {
        type: 'done', content: currentContent,
        toolCalls: [...toolCalls.filter(tc => tc.function.name), ...tail.toolCalls],
        metrics: { totalTime, ttft: firstTokenTime ? firstTokenTime - startTime : 0, tokens: totalTokens }
      };
    } catch (error) {
      log.error(`[${callId}] Groq error`, { error: error.message });
      yield { type: 'error', message: error.message };
    }
  }

  async completion({ callId, messages, model = 'llama-3.3-70b-versatile', tools = null, temperature = 0.7, maxTokens = 500 }) {
    const startTime = Date.now();
    const body = { model, messages, temperature, max_tokens: maxTokens };
    if (tools?.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`Groq error: ${response.status}`);
    const result = await response.json();
    const choice = result.choices[0];
    log.metric(`[${callId}] Groq non-stream in ${Date.now() - startTime}ms`);

    return {
      content: choice.message.content,
      toolCalls: choice.message.tool_calls || [],
      finishReason: choice.finish_reason,
      usage: result.usage,
      metrics: { totalTime: Date.now() - startTime }
    };
  }
}

module.exports = { GroqLLM };
