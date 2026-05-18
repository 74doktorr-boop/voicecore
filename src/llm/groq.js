// ============================================
// VoiceCore — Groq LLM (Ultra-Fast Inference)
// Llama 3.3 70B at ~80ms TTFT
// ============================================

const { Logger } = require('../utils/logger');
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
              currentContent += delta.content;
              totalTokens++;
              yield { type: 'text', content: delta.content, accumulated: currentContent };
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

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] Groq completed in ${totalTime}ms (~${totalTokens} tokens)`);

      yield {
        type: 'done', content: currentContent,
        toolCalls: toolCalls.filter(tc => tc.function.name),
        metrics: { totalTime, ttft: firstTokenTime ? firstTokenTime - startTime : 0, tokens: totalTokens }
      };
    } catch (error) {
      log.error(`[${callId}] Groq error`, { error: error.message });
      yield { type: 'error', error: error.message };
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
