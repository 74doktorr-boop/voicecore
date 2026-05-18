// ============================================
// VoiceCore — Twilio Media Streams Handler
// WebSocket handler for Twilio bidirectional audio
// ============================================

const { Logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const log = new Logger('TWILIO');

/**
 * Set up WebSocket handler for Twilio Media Streams
 * @param {WebSocketServer} wss - WebSocket server
 * @param {VoicePipeline} pipeline - Voice pipeline instance
 * @param {AssistantManager} assistantManager - Assistant manager
 */
function setupTwilioStreams(wss, pipeline, assistantManager) {

  wss.on('connection', (ws, req) => {
    const callId = uuidv4();
    let streamSid = null;
    let callSid = null;
    let sessionStarted = false;

    log.call(`[${callId}] New WebSocket connection`);

    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);

        switch (msg.event) {
          case 'connected':
            log.call(`[${callId}] Twilio connected`);
            break;

          case 'start':
            streamSid = msg.start.streamSid;
            callSid = msg.start.callSid;
            const callerNumber = msg.start.customParameters?.from || msg.start.customParameters?.callerNumber || 'unknown';
            const calledNumber = msg.start.customParameters?.to || msg.start.customParameters?.calledNumber || 'unknown';
            const assistantId = msg.start.customParameters?.assistantId;

            log.call(`[${callId}] Stream started`, { streamSid, callSid, callerNumber, assistantId });

            // Get assistant config
            let assistant;
            if (assistantId) {
              assistant = assistantManager.get(assistantId);
            }
            if (!assistant) {
              assistant = assistantManager.getByPhoneNumber(calledNumber) || assistantManager.getDefault();
            }

            if (!assistant) {
              log.error(`[${callId}] No assistant found, using default`);
              assistant = {
                id: 'default-fallback',
                name: 'Default Assistant',
                systemPrompt: 'Eres un asistente telefónico amable. Responde en español de forma concisa.',
                firstMessage: 'Hola, ¿en qué puedo ayudarte?',
                voice: 'nova',
                language: 'es',
                model: 'gpt-4o-mini',
              };
            }

            // Start call session
            await pipeline.startCall({
              callId,
              assistant,
              callerNumber,
              calledNumber,
              direction: 'inbound',
              twilioWs: ws,
              streamSid,
            });

            sessionStarted = true;
            break;

          case 'media':
            if (sessionStarted) {
              pipeline.handleAudio(callId, msg.media.payload);
            }
            break;

          case 'mark':
            if (sessionStarted && msg.mark?.name) {
              pipeline.handleMark(callId, msg.mark.name);
            }
            break;

          case 'stop':
            log.call(`[${callId}] Stream stopped`);
            break;

          default:
            break;
        }
      } catch (error) {
        log.error(`[${callId}] Error processing message`, { error: error.message });
      }
    });

    ws.on('close', () => {
      log.call(`[${callId}] WebSocket closed`);
      if (sessionStarted) {
        pipeline.endCall(callId);
      }
    });

    ws.on('error', (error) => {
      log.error(`[${callId}] WebSocket error`, { error: error.message });
    });
  });

  log.info('Twilio Media Streams handler ready');
}

/**
 * Generate TwiML for incoming calls
 */
function generateTwiML(wsUrl, assistantId = null) {
  const params = assistantId ? ` <Parameter name="assistantId" value="${assistantId}" />` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      ${params}
    </Stream>
  </Connect>
</Response>`;
}

module.exports = { setupTwilioStreams, generateTwiML };
