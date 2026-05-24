// ============================================
// VoiceCore v2.0 — Voice Pipeline
// Main orchestrator: STT → LLM → TTS
// Now with multi-provider routing
// ============================================

const { Logger } = require('../utils/logger');
const { STTRouter } = require('../stt/router');
const { LLMRouter } = require('../llm/router');
const { TTSRouter } = require('../tts/router');
const { ToolExecutor } = require('../tools/executor');
const { CallSession } = require('./call-session');
const { mulawToPcm, pcm8kToPcm16k } = require('../utils/audio');
const { sendAudioToVonage } = require('../telephony/vonage-handler');

const log = new Logger('PIPELINE');

class VoicePipeline {
  constructor(config) {
    // Use routers if provided, otherwise create from config
    this.sttRouter = config.sttRouter || new STTRouter({
      deepgramApiKey: config.deepgramApiKey,
      assemblyaiApiKey: config.assemblyaiApiKey,
      googleSttApiKey: config.googleSttApiKey,
    });

    this.llmRouter = config.llmRouter || new LLMRouter({
      openaiApiKey: config.openaiApiKey,
      groqApiKey: config.groqApiKey,
      anthropicApiKey: config.anthropicApiKey,
    });

    this.ttsRouter = config.ttsRouter || new TTSRouter({
      openaiApiKey: config.openaiApiKey,
      elevenlabsApiKey: config.elevenlabsApiKey,
      cartesiaApiKey: config.cartesiaApiKey,
      googleApiKey: config.googleApiKey,
    });

    this.toolExecutor = new ToolExecutor();
    this.activeCalls = new Map();
    this.callHistory = [];
    this.maxHistory = 500;
    this.webhookUrl = config.webhookUrl || null;
  }

  /**
   * Start a new call session
   */
  async startCall({ callId, assistant, callerNumber, calledNumber, direction, twilioWs, streamSid, vonageWs, provider = 'twilio' }) {
    const session = new CallSession({ callId, assistant, callerNumber, calledNumber, direction });
    session.twilioWs  = twilioWs;
    session.vonageWs  = vonageWs;
    session.streamSid = streamSid;
    session.provider  = provider;
    session.status    = 'active';
    this.activeCalls.set(callId, session);

    // Vonage sends L16 PCM 16kHz; Twilio sends mulaw 8kHz
    const isVonage = provider === 'vonage';

    // Create STT session via router
    const sttProvider = this.sttRouter.getProvider(assistant.sttProvider);
    const sttSession = sttProvider.createSession(callId, {
      language: assistant.language || 'es',
      model: assistant.sttModel || 'nova-3',
      utteranceEndMs: assistant.utteranceEndMs || 1000,
      endpointing: assistant.endpointing || 300,
      encoding: isVonage ? 'linear16' : 'mulaw',
      sample_rate: isVonage ? 16000 : 8000,
      sttProvider: assistant.sttProvider,
    });

    // On utterance end → process with LLM
    sttSession.onUtteranceEnd = async (text) => {
      if (session.isProcessing) return;
      if (!text?.trim() || text.trim().length < 2) return;
      await this._processTurn(callId, text);
    };

    // On speech start → handle interruption
    sttSession.onSpeechStart = () => {
      if (session.isSpeaking) {
        session.handleInterruption();
        session.clearTwilioBuffer();
        this.sttRouter.resetTranscript(callId);
      }
    };

    // Send first message if configured
    if (assistant.firstMessage) {
      await this._speakText(callId, assistant.firstMessage);
      session.addAssistantMessage(assistant.firstMessage);
    }

    // Fire webhook
    this._fireWebhook('call.started', session.toJSON());
    log.call(`[${callId}] Call started — ${callerNumber} → ${calledNumber}`);
    return session;
  }

  /**
   * Handle incoming audio from Twilio (base64-encoded mulaw)
   */
  handleAudio(callId, audioPayload) {
    const audioBuffer = Buffer.from(audioPayload, 'base64');
    this.sttRouter.sendAudio(callId, audioBuffer);
  }

  /**
   * Handle incoming raw PCM audio from Vonage (L16 binary buffer)
   */
  handleAudioPCM(callId, pcmBuffer, sampleRate) {
    this.sttRouter.sendAudio(callId, pcmBuffer);
  }

  /**
   * Handle mark event from Twilio
   */
  handleMark(callId, markName) {
    const session = this.activeCalls.get(callId);
    if (session) session.handleMark(markName);
  }

  /**
   * Process a conversation turn: LLM → (Tools) → TTS
   */
  async _processTurn(callId, userText) {
    const session = this.activeCalls.get(callId);
    if (!session) return;

    session.isProcessing = true;
    session.interrupted = false;
    const turnStart = Date.now();
    let turnMetrics = {};

    // Add user message
    session.addUserMessage(userText);

    try {
      // Get OpenAI tools format
      const tools = ToolExecutor.toOpenAITools(session.assistant.tools);

      // Resolve LLM model — supports "provider/model" format
      const modelSpec = session.assistant.model || 'gpt-4o-mini';
      const fallbackModel = session.assistant.fallbackModel || null;

      // Stream LLM response via router
      let fullResponse = '';
      let pendingToolCalls = [];
      let accumulatedText = '';

      for await (const chunk of this.llmRouter.streamCompletion({
        callId,
        messages: session.messages,
        model: modelSpec,
        tools,
        temperature: session.assistant.temperature || 0.7,
        maxTokens: session.assistant.maxTokens || 500,
        fallbackModel,
      })) {
        if (session.interrupted) break;

        if (chunk.type === 'text') {
          accumulatedText += chunk.content;
          // Stream TTS in sentences for low latency
          const sentences = this._extractCompleteSentences(accumulatedText);
          if (sentences.complete.length > 0) {
            for (const sentence of sentences.complete) {
              if (session.interrupted) break;
              await this._speakText(callId, sentence);
            }
            accumulatedText = sentences.remaining;
          }
        }

        if (chunk.type === 'tool_call') {
          pendingToolCalls.push(chunk.toolCall);
        }

        if (chunk.type === 'done') {
          fullResponse = chunk.content;
          turnMetrics.llmTime = chunk.metrics?.totalTime;
          turnMetrics.llmTokens = chunk.metrics?.tokens;
          turnMetrics.llmProvider = chunk.metrics?.provider;
          if (chunk.toolCalls?.length > 0) pendingToolCalls = chunk.toolCalls;
        }
      }

      // Speak any remaining text
      if (accumulatedText.trim() && !session.interrupted) {
        await this._speakText(callId, accumulatedText.trim());
      }

      // Handle tool calls
      if (pendingToolCalls.length > 0 && !session.interrupted) {
        await this._handleToolCalls(callId, session, pendingToolCalls, turnMetrics);
      } else if (fullResponse) {
        session.addAssistantMessage(fullResponse);
      }

      turnMetrics.totalTime = Date.now() - turnStart;
      session.recordTurn(turnMetrics);

    } catch (error) {
      log.error(`[${callId}] Turn processing error`, { error: error.message });
    } finally {
      session.isProcessing = false;
    }
  }

  /**
   * Handle tool calls from LLM
   */
  async _handleToolCalls(callId, session, toolCalls, turnMetrics) {
    session.addAssistantToolCallMessage(null, toolCalls);
    turnMetrics.toolCalls = toolCalls.length;
    const toolStart = Date.now();

    for (const tc of toolCalls) {
      if (session.interrupted) break;

      const result = await this.toolExecutor.execute(
        tc.function.name,
        JSON.parse(tc.function.arguments || '{}'),
        session.assistant.id
      );

      session.addToolMessage(tc.id, result.success !== undefined
        ? (result.success ? JSON.stringify(result) : `Error: ${result.error}`)
        : JSON.stringify(result));
    }

    turnMetrics.toolTime = Date.now() - toolStart;

    // Get LLM response after tool results
    if (!session.interrupted) {
      const modelSpec = session.assistant.model || 'gpt-4o-mini';
      let postToolResponse = '';

      for await (const chunk of this.llmRouter.streamCompletion({
        callId,
        messages: session.messages,
        model: modelSpec,
        temperature: session.assistant.temperature || 0.7,
        maxTokens: session.assistant.maxTokens || 500,
      })) {
        if (session.interrupted) break;
        if (chunk.type === 'text') postToolResponse += chunk.content;
        if (chunk.type === 'done') postToolResponse = chunk.content;
      }

      if (postToolResponse && !session.interrupted) {
        await this._speakText(callId, postToolResponse);
        session.addAssistantMessage(postToolResponse);
      }
    }
  }

  /**
   * Convert text to speech via TTS Router and send to Twilio
   */
  async _speakText(callId, text) {
    const session = this.activeCalls.get(callId);
    if (!session || session.interrupted) return;

    session.isSpeaking = true;
    const ttsStart = Date.now();

    try {
      // Use TTS Router with assistant's preferred provider/voice
      const mulaw = await this.ttsRouter.synthesize({
        callId,
        text,
        provider: session.assistant.ttsProvider || null,
        voice: session.assistant.voice || 'nova',
        speed: session.assistant.speed || 1.0,
        language: session.assistant.language || 'es',
        strategy: session.assistant.ttsStrategy || 'latency',
        fallback: session.assistant.ttsFallback || 'openai',
      });

      if (mulaw.length > 0 && !session.interrupted) {
        if (session.provider === 'vonage' && session.vonageWs) {
          // Vonage expects L16 PCM 16kHz — convert mulaw 8kHz → PCM 8kHz → PCM 16kHz
          const pcm16k = pcm8kToPcm16k(mulawToPcm(mulaw));
          sendAudioToVonage(session.vonageWs, pcm16k);
        } else {
          session.sendAudioToTwilio(mulaw);
        }
      }

      const ttsTime = Date.now() - ttsStart;
      log.metric(`[${callId}] TTS completed in ${ttsTime}ms`);

    } catch (error) {
      log.error(`[${callId}] TTS error`, { error: error.message });
    }
  }

  /**
   * Extract complete sentences from accumulated text
   */
  _extractCompleteSentences(text) {
    const sentenceEnders = /([.!?;])(\s+|$)/g;
    let lastIndex = 0;
    const complete = [];
    let match;

    while ((match = sentenceEnders.exec(text)) !== null) {
      complete.push(text.substring(lastIndex, match.index + match[1].length).trim());
      lastIndex = match.index + match[0].length;
    }

    return { complete, remaining: text.substring(lastIndex) };
  }

  /**
   * End a call
   */
  endCall(callId) {
    const session = this.activeCalls.get(callId);
    if (!session) return null;

    this.sttRouter.closeSession(callId);
    const callData = session.end();
    this.activeCalls.delete(callId);
    this.callHistory.unshift(callData);
    if (this.callHistory.length > this.maxHistory) this.callHistory.pop();
    this._fireWebhook('call.ended', callData);
    return callData;
  }

  /**
   * Get active calls
   */
  getActiveCalls() {
    return Array.from(this.activeCalls.values()).map(s => s.toJSON());
  }

  /**
   * Get call history
   */
  getCallHistory(limit = 50) {
    return this.callHistory.slice(0, limit);
  }

  /**
   * Get metrics summary
   */
  getMetrics() {
    const active = this.activeCalls.size;
    const total = this.callHistory.length;
    const totalCost = this.callHistory.reduce((sum, c) => sum + (c.cost?.total || 0), 0);
    const totalDuration = this.callHistory.reduce((sum, c) => sum + (c.duration || 0), 0);
    const avgTurns = total > 0 ? this.callHistory.reduce((sum, c) => sum + (c.turnCount || 0), 0) / total : 0;
    return {
      activeCalls: active,
      totalCalls: total,
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalDurationMinutes: Math.round(totalDuration / 60000 * 100) / 100,
      avgTurnsPerCall: Math.round(avgTurns * 10) / 10,
      providers: {
        stt: this.sttRouter.getMetrics(),
        llm: this.llmRouter.getMetrics(),
        tts: this.ttsRouter.getMetrics(),
      },
    };
  }

  /**
   * Fire webhook event
   */
  async _fireWebhook(event, data) {
    if (!this.webhookUrl) return;
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, timestamp: new Date().toISOString(), data }),
      });
    } catch (e) {
      log.error(`Webhook fire failed for ${event}`, { error: e.message });
    }
  }
}

module.exports = { VoicePipeline };
