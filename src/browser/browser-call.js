// Browser Voice Test — Low-latency streaming version
// Stream: Mic → Deepgram STT → OpenAI LLM (streaming) → TTS (per-sentence) → Audio
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const { Logger } = require('../utils/logger');
const { ToolExecutor } = require('../tools/executor');
const logger = new Logger('BROWSER');

class BrowserCallHandler {
  constructor(assistantManager) {
    this.assistantManager = assistantManager;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.toolExecutor = new ToolExecutor();
  }

  handleConnection(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const assistantId = url.searchParams.get('assistant') || 'demo-restaurant';
    const assistant = this.assistantManager.get(assistantId);

    if (!assistant) {
      ws.send(JSON.stringify({ type: 'error', message: `Assistant "${assistantId}" not found` }));
      ws.close();
      return;
    }

    logger.info(`Talk session started for: ${assistant.name || assistantId}`);

    const session = {
      assistantId, assistant,
      conversation: [],
      deepgramConnection: null,
      isProcessing: false,
      startTime: Date.now()
    };

    const systemPrompt = (assistant.systemPrompt || assistant.system_prompt || '')
      .replace('{{DATE}}', new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    if (systemPrompt) session.conversation.push({ role: 'system', content: systemPrompt });

    if (assistant.firstMessage) {
      ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', content: assistant.firstMessage }));
      session.conversation.push({ role: 'assistant', content: assistant.firstMessage });
      this.synthesizeAndSend(ws, assistant.firstMessage, assistant);
    }

    ws.send(JSON.stringify({ type: 'ready', assistant: assistant.name || assistantId }));
    this.initDeepgram(ws, session);

    ws.on('message', (data) => {
      if (typeof data === 'string') {
        try { const msg = JSON.parse(data); if (msg.type === 'stop') { this.cleanup(session); ws.close(); } } catch (e) {}
      } else {
        if (session.deepgramConnection) try { session.deepgramConnection.send(data); } catch (e) {}
      }
    });

    ws.on('close', () => {
      logger.info(`Talk session ended (${((Date.now() - session.startTime) / 1000).toFixed(1)}s)`);
      this.cleanup(session);
    });
    ws.on('error', (err) => { logger.error(`WS error: ${err.message}`); this.cleanup(session); });
  }

  initDeepgram(ws, session) {
    try {
      const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
      const connection = deepgram.listen.live({
        model: 'nova-3',
        language: session.assistant.language || 'es',
        smart_format: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
        interim_results: true,
        utterance_end_ms: 2200,
        endpointing: 900,
        vad_events: true
      });

      connection.on('open', () => {
        logger.info('Deepgram connected');
        ws.send(JSON.stringify({ type: 'listening' }));
      });

      let pendingTranscript = '';
      let processTimer = null;

      connection.on('Results', (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript) return;

        if (data.is_final) {
          pendingTranscript += (pendingTranscript ? ' ' : '') + transcript;
          ws.send(JSON.stringify({ type: 'interim', content: pendingTranscript }));

          if (processTimer) clearTimeout(processTimer);
          processTimer = setTimeout(async () => {
            if (pendingTranscript && !session.isProcessing) {
              const userText = pendingTranscript.trim();
              pendingTranscript = '';
              if (userText.length > 1) {
                ws.send(JSON.stringify({ type: 'transcript', role: 'user', content: userText, final: true }));
                session.conversation.push({ role: 'user', content: userText });
                await this.processWithLLM(ws, session);
              }
            }
          }, 1800); // 1.8s debounce — lets user finish complete thoughts
        } else {
          const display = pendingTranscript ? pendingTranscript + ' ' + transcript : transcript;
          ws.send(JSON.stringify({ type: 'interim', content: display }));
        }
      });

      session.deepgramConnection = connection;
    } catch (err) {
      logger.error(`Deepgram init failed: ${err.message}`);
      ws.send(JSON.stringify({ type: 'error', message: 'STT init failed' }));
    }
  }

  async processWithLLM(ws, session) {
    if (session.isProcessing) return;
    session.isProcessing = true;

    try {
      ws.send(JSON.stringify({ type: 'thinking' }));

      const tools = (session.assistant.tools || [])
        .filter(t => t.type === 'function')
        .map(t => ({ type: 'function', function: t.function }));

      // First check: does LLM want to call tools? (non-streaming probe)
      const probeParams = {
        model: session.assistant.model || 'gpt-4o-mini',
        messages: session.conversation,
        temperature: session.assistant.temperature || 0.7,
        max_tokens: session.assistant.maxTokens || 200,
      };
      if (tools.length > 0) probeParams.tools = tools;

      const probe = await this.openai.chat.completions.create(probeParams);
      const probeMsg = probe.choices[0].message;

      // Handle tool calls (may need multiple rounds)
      if (probeMsg.tool_calls && probeMsg.tool_calls.length > 0) {
        session.conversation.push(probeMsg);
        for (const tc of probeMsg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          logger.info(`Tool: ${tc.function.name}`, args);
          const result = await this.toolExecutor.execute(tc.function.name, args, session.assistantId);
          session.conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }

        // Now get the response after tool results — STREAM this for speed
        await this.streamResponse(ws, session, tools);
      } else if (probeMsg.content) {
        // No tools — we already have the response from probe
        session.conversation.push({ role: 'assistant', content: probeMsg.content });
        ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', content: probeMsg.content, final: true }));
        ws.send(JSON.stringify({ type: 'speaking' }));
        await this.synthesizeAndSend(ws, probeMsg.content, session.assistant);
        ws.send(JSON.stringify({ type: 'listening' }));
      }
    } catch (err) {
      logger.error(`LLM error: ${err.message}`);
      ws.send(JSON.stringify({ type: 'error', message: 'Error processing' }));
    } finally {
      session.isProcessing = false;
    }
  }

  async streamResponse(ws, session, tools) {
    const params = {
      model: session.assistant.model || 'gpt-4o-mini',
      messages: session.conversation,
      temperature: session.assistant.temperature || 0.7,
      max_tokens: session.assistant.maxTokens || 200,
      stream: true
    };

    const stream = await this.openai.chat.completions.create(params);
    let fullResponse = '';
    let sentenceBuffer = '';
    let firstSent = false;

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (!content) continue;

      fullResponse += content;
      sentenceBuffer += content;

      // Check for sentence boundary
      const match = sentenceBuffer.match(/[.!?¿¡]\s/);
      if (match) {
        const sentence = sentenceBuffer.substring(0, match.index + 1).trim();
        sentenceBuffer = sentenceBuffer.substring(match.index + 2);

        if (sentence.length > 3) {
          if (!firstSent) {
            ws.send(JSON.stringify({ type: 'speaking' }));
            firstSent = true;
          }
          // Fire TTS immediately — don't await, let it stream
          this.synthesizeAndSend(ws, sentence, session.assistant);
        }
      }
    }

    // Send remaining text
    if (sentenceBuffer.trim().length > 3) {
      if (!firstSent) ws.send(JSON.stringify({ type: 'speaking' }));
      await this.synthesizeAndSend(ws, sentenceBuffer.trim(), session.assistant);
    }

    if (fullResponse) {
      session.conversation.push({ role: 'assistant', content: fullResponse });
      ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', content: fullResponse, final: true }));
    }
    ws.send(JSON.stringify({ type: 'listening' }));
  }

  async synthesizeAndSend(ws, text, assistant) {
    try {
      const response = await this.openai.audio.speech.create({
        model: 'tts-1',
        voice: assistant.voice || 'nova',
        input: text,
        response_format: 'mp3',
        speed: assistant.speed || 1.0
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (ws.readyState === 1) {
        ws.send(Buffer.concat([Buffer.from([0x01]), buffer]));
      }
    } catch (err) {
      logger.error(`TTS error: ${err.message}`);
    }
  }

  cleanup(session) {
    if (session.deepgramConnection) {
      try { session.deepgramConnection.finish(); } catch (e) {}
      session.deepgramConnection = null;
    }
  }
}

module.exports = BrowserCallHandler;
