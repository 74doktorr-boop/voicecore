// ============================================
// VoiceCore — Vonage Voice API Handler
// WebSocket handler for Vonage bidirectional audio
// Audio format: L16 PCM 16kHz (binary frames)
// ============================================

const { Logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const log = new Logger('VONAGE');

/**
 * Generate NCCO (Nexmo Call Control Object) for incoming calls
 * Vonage calls this when a call is answered — we return JSON to connect to our WebSocket
 */
function generateNCCO(wsUrl, assistantId = null, callerNumber = null) {
  const headers = {};
  if (assistantId) headers.assistantId = assistantId;
  if (callerNumber) headers.callerNumber = callerNumber;

  return JSON.stringify([
    {
      action: 'connect',
      endpoint: [
        {
          type: 'websocket',
          uri: wsUrl,
          'content-type': 'audio/l16;rate=16000',
          headers,
        },
      ],
      eventType: 'synchronous',
    },
  ]);
}

/**
 * Set up WebSocket handler for Vonage Voice API
 * Vonage sends binary L16 PCM 16kHz audio frames
 * First message is a JSON text frame with call metadata
 */
function setupVonageStreams(wss, pipeline, assistantManager) {

  wss.on('connection', (ws, req) => {
    const callId = uuidv4();
    let sessionStarted = false;
    let vonageUUID = null;
    let conversationUUID = null;

    log.call(`[${callId}] New Vonage WebSocket connection`);

    // Audio buffer for accumulating PCM frames before sending to STT
    let audioBuffer = Buffer.alloc(0);
    const CHUNK_MS = 20; // send 20ms chunks to STT
    const SAMPLE_RATE = 16000;
    const BYTES_PER_SAMPLE = 2; // L16 = 16-bit = 2 bytes
    const CHUNK_SIZE = (SAMPLE_RATE * CHUNK_MS / 1000) * BYTES_PER_SAMPLE; // 640 bytes

    ws.on('message', async (message, isBinary) => {
      try {
        if (!isBinary) {
          // First message from Vonage is JSON with call metadata
          const meta = JSON.parse(message.toString());
          log.call(`[${callId}] Vonage metadata`, meta);

          vonageUUID = meta['vonage-uuid'] || meta.uuid;
          conversationUUID = meta['conversation-uuid'];

          const callerNumber = meta.from || 'unknown';
          const calledNumber  = meta.to   || 'unknown';
          const assistantId   = meta.assistantId; // passed via NCCO headers

          // Get assistant config
          let assistant;
          if (assistantId) assistant = assistantManager.get(assistantId);
          if (!assistant)  assistant = assistantManager.getByPhoneNumber(calledNumber) || assistantManager.getDefault();

          if (!assistant) {
            assistant = {
              id: 'default-fallback',
              name: 'Default Assistant',
              systemPrompt: 'Eres un asistente telefónico amable. Responde en español de forma concisa.',
              firstMessage: '¡Hola! ¿En qué puedo ayudarte?',
              voice: 'nova',
              language: 'es',
              model: 'gpt-4o-mini',
            };
          }

          // Start call session — pass vonageWs instead of twilioWs
          await pipeline.startCall({
            callId,
            assistant,
            callerNumber,
            calledNumber,
            direction: 'inbound',
            vonageWs: ws,          // Vonage WebSocket reference
            provider: 'vonage',
          });

          sessionStarted = true;
          log.call(`[${callId}] Vonage session started — assistant: ${assistant.id}`);

        } else {
          // Binary frames = L16 PCM 16kHz audio from caller
          if (!sessionStarted) return;

          audioBuffer = Buffer.concat([audioBuffer, message]);

          // Feed chunks to pipeline
          while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            // pipeline.handleAudioPCM expects raw L16 PCM buffer + sampleRate
            pipeline.handleAudioPCM(callId, chunk, SAMPLE_RATE);
          }
        }
      } catch (error) {
        log.error(`[${callId}] Error processing message`, { error: error.message });
      }
    });

    ws.on('close', () => {
      log.call(`[${callId}] Vonage WebSocket closed`);
      if (sessionStarted) pipeline.endCall(callId);
    });

    ws.on('error', (error) => {
      log.error(`[${callId}] WebSocket error`, { error: error.message });
    });
  });

  log.info('Vonage Voice API handler ready');
}

/**
 * Send L16 PCM audio back to Vonage caller
 * @param {WebSocket} ws - Vonage WebSocket
 * @param {Buffer} pcmBuffer - Raw L16 PCM 16kHz audio
 */
function sendAudioToVonage(ws, pcmBuffer) {
  if (!ws || ws.readyState !== 1 /* OPEN */) return;
  try {
    // Vonage expects raw binary L16 frames — send in 20ms chunks
    const CHUNK = 640; // 20ms @ 16kHz L16
    for (let i = 0; i < pcmBuffer.length; i += CHUNK) {
      ws.send(pcmBuffer.slice(i, Math.min(i + CHUNK, pcmBuffer.length)));
    }
  } catch (e) {
    log.error('Error sending audio to Vonage', { error: e.message });
  }
}

module.exports = { setupVonageStreams, generateNCCO, sendAudioToVonage };
