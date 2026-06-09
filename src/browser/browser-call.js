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
    this._openai = null; // lazy-init to avoid crash if OPENAI_API_KEY missing at startup
    this.toolExecutor = new ToolExecutor();
  }

  get openai() {
    if (!this._openai) {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
      this._openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this._openai;
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

    const _now = new Date();
    const _madridHour = parseInt(_now.toLocaleTimeString('es-ES', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }), 10);
    const _greeting =
      _madridHour >= 6  && _madridHour < 14 ? 'Buenos días'   :
      _madridHour >= 14 && _madridHour < 21 ? 'Buenas tardes' :
                                              'Buenas noches';

    const systemPrompt = (assistant.systemPrompt || assistant.system_prompt || '')
      // BUG-47: pin to Europe/Madrid — server runs UTC
      .replace('{{DATE}}', _now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Madrid' }))
      .replace(/\{\{GREETING\}\}/g, _greeting);
    if (systemPrompt) session.conversation.push({ role: 'system', content: systemPrompt });

    if (assistant.firstMessage) {
      const firstMsg = assistant.firstMessage.replace(/\{\{GREETING\}\}/g, _greeting);
      ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', content: firstMsg }));
      session.conversation.push({ role: 'assistant', content: firstMsg });
      this.synthesizeAndSend(ws, firstMsg, assistant);
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
        utterance_end_ms: 800,   // was 2200 — faster fallback trigger
        endpointing: 300,         // was 900 — detect silence 3x faster
        vad_events: true
      });

      connection.on('open', () => {
        logger.info('Deepgram connected');
        ws.send(JSON.stringify({ type: 'listening' }));
      });

      let pendingTranscript = '';
      let processTimer = null;

      // Fire LLM immediately — called from speech_final or fallback timer
      const triggerLLM = () => {
        if (processTimer) { clearTimeout(processTimer); processTimer = null; }
        if (!pendingTranscript || session.isProcessing) return;
        const userText = pendingTranscript.trim();
        pendingTranscript = '';
        if (userText.length > 1) {
          ws.send(JSON.stringify({ type: 'transcript', role: 'user', content: userText, final: true }));
          session.conversation.push({ role: 'user', content: userText });
          this.processWithLLM(ws, session);
        }
      };

      connection.on('Results', (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript) return;

        if (data.is_final) {
          pendingTranscript += (pendingTranscript ? ' ' : '') + transcript;
          ws.send(JSON.stringify({ type: 'interim', content: pendingTranscript }));

          if (data.speech_final) {
            // Deepgram is confident user has finished — trigger immediately, no debounce
            triggerLLM();
          } else {
            // Fallback: short timer in case speech_final never comes
            if (processTimer) clearTimeout(processTimer);
            processTimer = setTimeout(triggerLLM, 400);
          }
        } else {
          const display = pendingTranscript ? pendingTranscript + ' ' + transcript : transcript;
          ws.send(JSON.stringify({ type: 'interim', content: display }));
        }
      });

      // UtteranceEnd as extra safety net
      connection.on('UtteranceEnd', () => {
        if (pendingTranscript && !session.isProcessing) triggerLLM();
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

      if (tools.length === 0) {
        // No tools → stream directly, TTS starts on first sentence (~300ms faster)
        await this.streamResponse(ws, session, []);
      } else {
        // Has tools → probe first to detect tool calls vs content
        const probe = await this.openai.chat.completions.create({
          model: session.assistant.model || 'gpt-4o-mini',
          messages: session.conversation,
          temperature: session.assistant.temperature || 0.7,
          max_tokens: session.assistant.maxTokens || 500,
          tools,
        });
        const probeMsg = probe.choices[0].message;

        if (probeMsg.tool_calls && probeMsg.tool_calls.length > 0) {
          session.conversation.push(probeMsg);
          for (const tc of probeMsg.tool_calls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
            logger.info(`Tool: ${tc.function.name}`, args);
            const result = await this.toolExecutor.execute(tc.function.name, args, session.assistantId);
            session.conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          }
          await this.streamResponse(ws, session, []);
        } else if (probeMsg.content) {
          session.conversation.push({ role: 'assistant', content: probeMsg.content });
          ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', content: probeMsg.content, final: true }));
          ws.send(JSON.stringify({ type: 'speaking' }));
          await this.synthesizeAndSend(ws, probeMsg.content, session.assistant);
          ws.send(JSON.stringify({ type: 'listening' }));
        }
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
      max_tokens: session.assistant.maxTokens || 500,  // was 200 — prevents mid-sentence cutoffs
      stream: true
    };
    if (tools.length > 0) params.tools = tools;

    const stream = await this.openai.chat.completions.create(params);
    let fullResponse = '';
    let sentenceBuffer = '';
    // Serial TTS chain: each sentence waits for the previous to finish → guaranteed audio order
    let ttsChain = Promise.resolve();
    let firstSent = false;

    const enqueueTTS = (text) => {
      if (!firstSent) {
        ws.send(JSON.stringify({ type: 'speaking' }));
        firstSent = true;
      }
      // Chain so each TTS starts only after the previous audio packet is sent
      ttsChain = ttsChain.then(() => this.synthesizeAndSend(ws, text, session.assistant));
    };

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (!content) continue;

      fullResponse += content;
      sentenceBuffer += content;

      // Extract complete sentences from buffer.
      // Only [.!?] are sentence-enders — ¿¡ are Spanish openers, not enders.
      // Require 4+ char word before punctuation to avoid splitting on abbreviations (Dr., Sr.)
      let match;
      while ((match = sentenceBuffer.match(/^(.*?\b\w{4,}[.!?])\s+/s)) !== null) {
        const sentence = match[1].trim();
        sentenceBuffer = sentenceBuffer.slice(match[0].length);
        if (sentence.length > 3) enqueueTTS(sentence);
      }
    }

    // Flush remaining buffer (final sentence with no trailing space)
    const remaining = sentenceBuffer.trim();
    if (remaining.length > 1) enqueueTTS(remaining);

    // Wait for all audio packets to be sent before signaling ready-to-listen
    await ttsChain;

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
