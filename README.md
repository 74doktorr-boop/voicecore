# 🎙️ VoiceCore

**Open-source Voice AI Platform** — A self-hosted alternative to Vapi, built by NodeFlow Agency.

> **72% cheaper** than Vapi. Same features + more. Full control.

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your API keys

# 3. Run
npm start
```

## Architecture

```
Phone Call → Twilio Media Streams → VoiceCore Server
                                      ├── Deepgram (STT)
                                      ├── OpenAI (LLM + Tools)
                                      └── OpenAI/ElevenLabs (TTS)
                                      → Audio back to Twilio → Caller
```

## Cost Comparison

| Component | Vapi | VoiceCore | Savings |
|-----------|------|-----------|---------|
| Platform Fee | $0.050/min | **$0.000/min** | 100% |
| Twilio | $0.014/min | $0.018/min | — |
| STT (Deepgram) | $0.008/min | $0.008/min | — |
| LLM (GPT-4o-mini) | $0.010/min | $0.005/min | 50% |
| TTS | $0.100/min | $0.020/min | 80% |
| **Total** | **~$0.18/min** | **~$0.05/min** | **72%** |

## Features

- ✅ Real-time STT (Deepgram Nova-3)
- ✅ Streaming LLM (OpenAI GPT-4o-mini)
- ✅ TTS with fallback (OpenAI / ElevenLabs)
- ✅ Tool/Function calling via webhooks
- ✅ Interruption handling (barge-in)
- ✅ Professional dashboard
- ✅ Hot-reload assistant configs
- ✅ Per-call cost tracking
- ✅ REST API
- ✅ Multi-assistant support

## API

```bash
# Health check
curl http://localhost:3001/health

# List assistants
curl -H "x-api-key: YOUR_KEY" http://localhost:3001/api/assistants

# Call history
curl -H "x-api-key: YOUR_KEY" http://localhost:3001/api/calls/history
```

## Dashboard

Visit `http://localhost:3001/dashboard` for the full management UI.

## License

Proprietary — NodeFlow Agency © 2026
