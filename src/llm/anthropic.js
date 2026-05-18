// ============================================
// VoiceCore — Anthropic Claude LLM
// Claude 4 Sonnet/Opus for advanced reasoning
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('LLM:CLAUDE');

class AnthropicLLM {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.anthropic.com/v1';
  }

  async *streamCompletion({ callId, messages, model = 'claude-sonnet-4-20250514', tools = null, temperature = 0.7, maxTokens = 500 }) {
    const startTime = Date.now();
    let firstTokenTime = null;
    let totalTokens = 0;

    // Convert OpenAI format to Anthropic format
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => {
      if (m.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] };
      if (m.role === 'assistant' && m.tool_calls) {
        return { role: 'assistant', content: m.tool_calls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') })) };
      }
      return { role: m.role, content: m.content };
    });

    const body = { model, messages: chatMessages, max_tokens: maxTokens, temperature, stream: true };
    if (systemMsg) body.system = systemMsg.content;
    if (tools?.length > 0) {
      body.tools = tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
    }

    log.llm(`[${callId}] Claude request`, { model, msgs: chatMessages.length });

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`Claude error: ${response.status} ${await response.text()}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentContent = '';
      let toolCalls = [];
      let currentToolUse = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'content_block_start') {
              if (event.content_block?.type === 'tool_use') {
                currentToolUse = { id: event.content_block.id, type: 'function', function: { name: event.content_block.name, arguments: '' } };
              }
            }

            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta' && event.delta.text) {
                if (!firstTokenTime) { firstTokenTime = Date.now(); log.metric(`[${callId}] Claude TTFT: ${firstTokenTime - startTime}ms`); }
                currentContent += event.delta.text;
                totalTokens++;
                yield { type: 'text', content: event.delta.text, accumulated: currentContent };
              }
              if (event.delta?.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.function.arguments += event.delta.partial_json;
              }
            }

            if (event.type === 'content_block_stop' && currentToolUse) {
              toolCalls.push(currentToolUse);
              yield { type: 'tool_call', toolCall: currentToolUse };
              currentToolUse = null;
            }

            if (event.type === 'message_stop') break;
          } catch (e) { /* skip */ }
        }
      }

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] Claude completed in ${totalTime}ms`);

      yield {
        type: 'done', content: currentContent,
        toolCalls: toolCalls.filter(tc => tc.function.name),
        metrics: { totalTime, ttft: firstTokenTime ? firstTokenTime - startTime : 0, tokens: totalTokens }
      };
    } catch (error) {
      log.error(`[${callId}] Claude error`, { error: error.message });
      yield { type: 'error', error: error.message };
    }
  }
}

module.exports = { AnthropicLLM };
