// ============================================
// VoiceCore — OpenAI LLM Module
// Chat completions with streaming + function calling
// ============================================

const OpenAI = require('openai');
const { Logger } = require('../utils/logger');

const log = new Logger('LLM');

class OpenAILLM {
  constructor(apiKey) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Get a streaming chat completion with optional tool calling
   * @param {object} params
   * @param {string} params.callId - Call identifier for logging
   * @param {Array} params.messages - Conversation history
   * @param {string} params.model - Model to use
   * @param {Array} params.tools - Tool definitions (optional)
   * @param {number} params.temperature - Temperature (0-2)
   * @param {number} params.maxTokens - Max tokens
   * @returns {AsyncGenerator} Yields text chunks or tool calls
   */
  async *streamCompletion({ callId, messages, model = 'gpt-4o-mini', tools = null, temperature = 0.7, maxTokens = 500 }) {
    const startTime = Date.now();
    let firstTokenTime = null;
    let totalTokens = 0;

    const requestParams = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };

    if (tools && tools.length > 0) {
      requestParams.tools = tools;
      requestParams.tool_choice = 'auto';
    }

    log.llm(`[${callId}] Requesting completion`, { model, messageCount: messages.length, hasTools: !!tools });

    try {
      const stream = await this.client.chat.completions.create(requestParams);

      let currentContent = '';
      let toolCalls = [];
      let currentToolCall = null;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Track first token latency
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
          const ttft = firstTokenTime - startTime;
          log.metric(`[${callId}] LLM TTFT: ${ttft}ms`);
        }

        // Text content
        if (delta.content) {
          currentContent += delta.content;
          totalTokens++;
          yield { type: 'text', content: delta.content, accumulated: currentContent };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              // New tool call or continuation
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }

        // Check if done
        if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
          for (const tc of toolCalls) {
            if (tc.function.name) {
              log.tool(`[${callId}] Tool call: ${tc.function.name}`, { args: tc.function.arguments });
              yield { type: 'tool_call', toolCall: tc };
            }
          }
        }
      }

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] LLM completed in ${totalTime}ms (~${totalTokens} tokens)`);

      // Yield completion signal
      yield { 
        type: 'done', 
        content: currentContent, 
        toolCalls: toolCalls.filter(tc => tc.function.name),
        metrics: {
          totalTime,
          ttft: firstTokenTime ? firstTokenTime - startTime : 0,
          tokens: totalTokens
        }
      };

    } catch (error) {
      log.error(`[${callId}] LLM error`, { error: error.message });
      yield { type: 'error', message: error.message };
    }
  }

  /**
   * Non-streaming completion (for simple tool result processing)
   */
  async completion({ callId, messages, model = 'gpt-4o-mini', tools = null, temperature = 0.7, maxTokens = 500 }) {
    const startTime = Date.now();
    
    const requestParams = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    if (tools && tools.length > 0) {
      requestParams.tools = tools;
      requestParams.tool_choice = 'auto';
    }

    try {
      const response = await this.client.chat.completions.create(requestParams);
      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] LLM non-stream completed in ${totalTime}ms`);

      const choice = response.choices[0];
      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls || [],
        finishReason: choice.finish_reason,
        usage: response.usage,
        metrics: { totalTime }
      };
    } catch (error) {
      log.error(`[${callId}] LLM error`, { error: error.message });
      throw error;
    }
  }
}

module.exports = { OpenAILLM };
