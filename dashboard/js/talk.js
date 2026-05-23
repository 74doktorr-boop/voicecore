// NodeFlow IA — Browser Talk Client
// Captures microphone, sends to server via WebSocket, plays TTS audio back

class TalkClient {
  constructor() {
    this.ws = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.processor = null;
    this.isActive = false;
    this.assistantId = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.playbackCtx = null;
  }

  async start(assistantId) {
    this.assistantId = assistantId;
    this.isActive = true;

    // Open WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws/talk?assistant=${assistantId}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = () => this.handleClose();
    this.ws.onerror = (err) => { console.error('Talk WS error:', err); this.updateUI('error', 'Connection failed'); };

    this.ws.onopen = async () => {
      try {
        // Request microphone
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
        });

        this.audioContext = new AudioContext({ sampleRate: 16000 });
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);

        // Use ScriptProcessor for wider browser support
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (e) => {
          if (!this.isActive || this.ws.readyState !== WebSocket.OPEN) return;
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          this.ws.send(pcm16.buffer);
        };

        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);

        this.updateUI('connected');
      } catch (err) {
        console.error('Mic access denied:', err);
        this.updateUI('error', 'Permiso de micrófono denegado. Acepta el permiso e inténtalo de nuevo.');
        // Don't auto-close — let user see the error
      }
    };
  }

  handleMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      // Binary: audio data (first byte is type marker)
      const data = new Uint8Array(event.data);
      if (data[0] === 0x01) {
        // MP3 audio chunk
        const audioData = data.slice(1);
        this.playAudio(audioData);
      }
    } else {
      // JSON message
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'ready':
          this.updateUI('ready', msg.assistant);
          break;
        case 'listening':
          this.updateUI('listening');
          break;
        case 'transcript':
          this.addTranscript(msg.role, msg.content);
          break;
        case 'interim':
          this.showInterim(msg.content);
          break;
        case 'thinking':
          this.updateUI('thinking');
          break;
        case 'speaking':
          this.updateUI('speaking');
          break;
        case 'text_delta':
          this.appendDelta(msg.content);
          break;
        case 'error':
          this.updateUI('error', msg.message);
          break;
      }
    }
  }

  async playAudio(mp3Data) {
    this.audioQueue.push(mp3Data);
    if (!this.isPlaying) this.processAudioQueue();
  }

  async processAudioQueue() {
    if (this.audioQueue.length === 0) { this.isPlaying = false; return; }
    this.isPlaying = true;
    const data = this.audioQueue.shift();

    try {
      // Reuse single AudioContext for smooth playback
      if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
        this.playbackCtx = new AudioContext();
      }
      const buffer = await this.playbackCtx.decodeAudioData(data.buffer.slice(0));
      const source = this.playbackCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.playbackCtx.destination);
      source.onended = () => this.processAudioQueue();
      source.start();
    } catch (err) {
      console.error('Audio playback error:', err);
      this.processAudioQueue();
    }
  }

  updateUI(state, detail) {
    const status = document.getElementById('talkStatus');
    const indicator = document.getElementById('talkIndicator');
    if (!status) return;

    const states = {
      connected: { text: 'Connected — requesting mic...', class: 'connecting' },
      ready: { text: `Talking to ${detail || 'Assistant'}`, class: 'ready' },
      listening: { text: '🎤 Listening...', class: 'listening' },
      thinking: { text: '🧠 Thinking...', class: 'thinking' },
      speaking: { text: '🔊 Speaking...', class: 'speaking' },
      error: { text: `❌ ${detail}`, class: 'error' },
      ended: { text: 'Call ended', class: 'ended' }
    };

    const s = states[state] || { text: state, class: '' };
    status.textContent = s.text;
    if (indicator) {
      indicator.className = `talk-indicator ${s.class}`;
    }
  }

  addTranscript(role, content) {
    const container = document.getElementById('talkTranscript');
    if (!container) return;

    // Remove interim if exists
    const interim = container.querySelector('.interim');
    if (interim) interim.remove();

    const div = document.createElement('div');
    div.className = `talk-msg ${role}`;
    div.innerHTML = `<span class="avatar">${role === 'user' ? '👤' : '⚡'}</span><span class="text">${this.escapeHtml(content)}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  showInterim(content) {
    const container = document.getElementById('talkTranscript');
    if (!container) return;
    let interim = container.querySelector('.interim');
    if (!interim) {
      interim = document.createElement('div');
      interim.className = 'talk-msg user interim';
      interim.innerHTML = `<span class="avatar">👤</span><span class="text"></span>`;
      container.appendChild(interim);
    }
    interim.querySelector('.text').textContent = content;
    container.scrollTop = container.scrollHeight;
  }

  appendDelta(content) {
    // For streaming LLM text display (optional)
  }

  handleClose() {
    this.updateUI('ended');
    this.isActive = false;
  }

  stop() {
    this.isActive = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
      this.ws.close();
    }
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    if (this.playbackCtx) { try { this.playbackCtx.close(); } catch(e) {} this.playbackCtx = null; }
    this.audioQueue = [];
    this.isPlaying = false;
  }

  escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}

// Global instance
const talkClient = new TalkClient();

function startTalk(assistantId) {
  document.getElementById('talkTranscript').innerHTML = '';
  document.getElementById('talkStatus').textContent = 'Conectando...';
  document.getElementById('talkIndicator').className = 'talk-indicator connecting';
  openModal('talkModal');
  talkClient.start(assistantId);
}

function stopTalk() {
  talkClient.stop();
  closeModal('talkModal');
}
