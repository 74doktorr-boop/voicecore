"""
VoiceCore — Local TTS Server (RTX 4090)
========================================
FastAPI server wrapping F5-TTS for zero-shot Basque voice cloning.
Called by Node.js via HTTP; returns raw PCM 24 kHz 16-bit mono.

F5-TTS (https://github.com/SWivid/F5-TTS) is a flow-matching TTS model
with native zero-shot voice cloning. Unlike XTTS v2 it has no hardcoded
language list — any language phonable with the training alphabet works,
including Basque. Fine-tune on native recordings for production quality.

Architecture
------------
* F5-TTS is NOT thread-safe on GPU. All synthesis runs inside a single
  ThreadPoolExecutor worker (max_workers=1) protected by asyncio.Semaphore.
  Concurrent requests queue and are served in order without crashing.
* Warm-up synthesis fires at startup to pre-compile CUDA kernels. First
  real call runs at full speed.
* Each voice profile is defined in config/voice_profiles.json which maps
  voice_id → {wav, ref_text, language}. ref_text is what the speaker says
  in the reference audio; leaving it empty triggers auto-transcription via
  Whisper (slower, less reliable — always fill it in for production voices).
* Requests exceeding REQUEST_TIMEOUT seconds are cancelled → HTTP 504.
* GET /health returns HTTP 503 while model is loading so Node.js waits.
* voice_id is validated against a strict regex (path traversal protection).

Setup
-----
    # 1. CUDA PyTorch — MUST come first
    pip install torch --index-url https://download.pytorch.org/whl/cu121

    # 2. Server deps
    pip install -r requirements-tts.txt

    # 3. Add reference audio and transcript for each voice
    # Edit config/voice_profiles.json with ref_text for each voice
    # Place corresponding WAV files in voices/
    #   voices/ane.wav     — female Basque speaker, 10-30 s of clear speech
    #   voices/mikel.wav   — male Basque speaker

    # 4. Run
    python tts_server.py

Environment variables
---------------------
    VOICES_DIR         Path to WAV reference files  (default: ./voices)
    PROFILES_FILE      Voice profiles JSON          (default: ./config/voice_profiles.json)
    TTS_HOST           Bind address                 (default: 0.0.0.0)
    TTS_PORT           Port                         (default: 8000)
    MAX_TEXT_CHARS     Max text length per request  (default: 500)
    REQUEST_TIMEOUT    Seconds before abort → 504   (default: 30)
    F5_MODEL_TYPE      "F5TTS" or "E2TTS"           (default: F5TTS)
    F5_NFE_STEP        Flow-matching steps (32=fast, 64=high quality) (default: 32)
"""

import asyncio
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [tts-server] %(levelname)s %(message)s",
)
log = logging.getLogger("tts-server")

# ── Configuration ──────────────────────────────────────────────────────────────
VOICES_DIR      = Path(os.getenv("VOICES_DIR", "voices"))
PROFILES_FILE   = Path(os.getenv("PROFILES_FILE", "config/voice_profiles.json"))
HOST            = os.getenv("TTS_HOST", "0.0.0.0")
PORT            = int(os.getenv("TTS_PORT", "8000"))
MAX_TEXT_CHARS  = int(os.getenv("MAX_TEXT_CHARS", "500"))
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "30"))
F5_MODEL_TYPE   = os.getenv("F5_MODEL_TYPE", "F5TTS")
F5_NFE_STEP     = int(os.getenv("F5_NFE_STEP", "32"))

SAMPLE_RATE = 24_000  # F5-TTS native output

# voice_id must be a safe filename segment — no path separators, no dots
_VOICE_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")

# ── Global state ───────────────────────────────────────────────────────────────
_f5_model     = None
_voice_profiles: dict = {}

# Single worker — F5-TTS must never run concurrently on the same GPU context
_gpu_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="f5tts-gpu")
_gpu_sem      = asyncio.Semaphore(1)


# ── Helpers ────────────────────────────────────────────────────────────────────
def _load_voice_profiles() -> dict:
    """Load voice profiles from JSON. Missing file → empty dict (still works with fallback)."""
    if not PROFILES_FILE.exists():
        log.warning(f"Voice profiles file not found: {PROFILES_FILE} — ref_text will be empty (auto-transcription)")
        return {}
    with PROFILES_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    log.info(f"Loaded {len(data)} voice profile(s) from {PROFILES_FILE}")
    return data


def _resolve_voice_file(voice_id: str) -> tuple[Path, str]:
    """
    Returns (wav_path, ref_text) for a voice_id.
    Falls back to first available WAV if voice_id has no dedicated file.
    ref_text is empty string if not configured (triggers F5-TTS auto-transcription via Whisper).
    """
    profile   = _voice_profiles.get(voice_id, {})
    wav_key   = profile.get("wav", f"voices/{voice_id}.wav")
    ref_text  = profile.get("ref_text", "")

    candidate = Path(wav_key)
    if not candidate.is_absolute():
        candidate = Path(wav_key)  # relative paths work from cwd

    if candidate.exists():
        return candidate, ref_text

    # Try VOICES_DIR directly
    direct = VOICES_DIR / f"{voice_id}.wav"
    if direct.exists():
        return direct, ref_text

    # Last resort: first available WAV
    fallbacks = sorted(VOICES_DIR.glob("*.wav"))
    if not fallbacks:
        raise FileNotFoundError(
            f"No voice profiles found in {VOICES_DIR.resolve()}. "
            "Add at least one .wav reference file and configure config/voice_profiles.json."
        )
    log.warning(f"Voice '{voice_id}' not found — falling back to '{fallbacks[0].stem}'")
    fallback_profile = _voice_profiles.get(fallbacks[0].stem, {})
    return fallbacks[0], fallback_profile.get("ref_text", "")


def _synthesize_blocking(text: str, wav_path: Path, ref_text: str) -> bytes:
    """
    Runs in the GPU thread. Returns raw PCM int16 bytes at SAMPLE_RATE Hz.
    Must only ever run one instance at a time (enforced by _gpu_sem + executor).

    If ref_text is empty, F5-TTS will auto-transcribe the reference audio using
    Whisper internally. This adds ~2-4 s latency. For production voices, always
    set ref_text in config/voice_profiles.json.
    """
    t0 = time.perf_counter()

    wav_array, sr, _ = _f5_model.infer(
        ref_file=str(wav_path),
        ref_text=ref_text,
        gen_text=text,
        nfe_step=F5_NFE_STEP,
        cross_fade_duration=0.10,
        speed=1.0,
        show_info=False,
        progress=False,
        remove_silence=False,
    )

    elapsed        = time.perf_counter() - t0
    audio_duration = len(wav_array) / sr if sr > 0 else 0
    rtf            = elapsed / audio_duration if audio_duration > 0 else 0

    log.info(
        f"Synthesized {len(text)} chars in {elapsed:.2f}s → "
        f"{audio_duration:.2f}s audio (RTF {rtf:.3f}x, nfe_step={F5_NFE_STEP})"
    )

    # Resample to SAMPLE_RATE if model returned different rate
    if sr != SAMPLE_RATE:
        try:
            import librosa
            wav_array = librosa.resample(wav_array.astype(np.float32), orig_sr=sr, target_sr=SAMPLE_RATE)
        except ImportError:
            log.warning(f"librosa not available — cannot resample {sr}→{SAMPLE_RATE} Hz")

    wav_norm  = np.array(wav_array, dtype=np.float32)
    pcm_int16 = (wav_norm * 32_767).clip(-32_768, 32_767).astype(np.int16)
    return pcm_int16.tobytes()


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _f5_model, _voice_profiles

    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log.info(f"Starting — device: {device}, model: {F5_MODEL_TYPE}, nfe_step: {F5_NFE_STEP}")

    VOICES_DIR.mkdir(exist_ok=True)
    PROFILES_FILE.parent.mkdir(exist_ok=True)

    _voice_profiles = _load_voice_profiles()

    loop = asyncio.get_running_loop()

    def _load_model():
        from f5_tts.api import F5TTS  # downloaded on first run (~1.2 GB)
        return F5TTS(model_type=F5_MODEL_TYPE, device=device)

    log.info(f"Loading {F5_MODEL_TYPE} — first run downloads ~1.2 GB and takes ~60 s …")
    try:
        _f5_model = await loop.run_in_executor(_gpu_executor, _load_model)
    except Exception:
        log.exception(f"Failed to load {F5_MODEL_TYPE} — ensure f5-tts is installed and CUDA is available")
        raise

    # Warm-up: pre-compile CUDA kernels so first real call is fast
    voices = sorted(VOICES_DIR.glob("*.wav"))
    if voices:
        ref_wav  = voices[0]
        ref_id   = ref_wav.stem
        profile  = _voice_profiles.get(ref_id, {})
        ref_text = profile.get("ref_text", "")

        log.info(f"Warming up with voice: {ref_wav.name} (ref_text={'set' if ref_text else 'empty → auto'})")

        def _warmup():
            _f5_model.infer(
                ref_file=str(ref_wav),
                ref_text=ref_text,
                gen_text="Kaixo.",
                nfe_step=F5_NFE_STEP,
                show_info=False,
                progress=False,
            )

        try:
            await asyncio.wait_for(
                loop.run_in_executor(_gpu_executor, _warmup),
                timeout=120.0,
            )
            log.info(f"Warm-up done. Voice profiles loaded: {[v.stem for v in voices]}")
        except asyncio.TimeoutError:
            log.warning("Warm-up timed out — server is ready but first real call may be slow")
    else:
        log.warning(
            f"No .wav files in {VOICES_DIR.resolve()} — "
            "add reference audio before making synthesis requests"
        )

    log.info(f"Server ready — {HOST}:{PORT}")
    yield

    log.info("Shutdown — releasing GPU resources")
    _gpu_executor.shutdown(wait=False)


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="VoiceCore Local TTS",
    version="2.0.0",
    description="F5-TTS zero-shot voice cloning for native Basque (eu) synthesis on RTX 4090",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Request schema ─────────────────────────────────────────────────────────────
class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str = "ane"
    language: str = "eu"  # informational only — F5-TTS is language-agnostic

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text is empty")
        if len(v) > MAX_TEXT_CHARS:
            raise ValueError(f"text is {len(v)} chars — max is {MAX_TEXT_CHARS}")
        return v

    @field_validator("voice_id")
    @classmethod
    def validate_voice_id(cls, v: str) -> str:
        if not _VOICE_ID_RE.match(v):
            raise ValueError(
                "voice_id must be 1-64 alphanumeric chars, hyphens or underscores"
            )
        return v


# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    if _f5_model is None:
        raise HTTPException(
            status_code=503,
            detail="Model is still loading — retry in a few seconds",
        )

    try:
        wav_path, ref_text = _resolve_voice_file(req.voice_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    loop = asyncio.get_running_loop()
    try:
        async with _gpu_sem:
            pcm_bytes = await asyncio.wait_for(
                loop.run_in_executor(
                    _gpu_executor,
                    _synthesize_blocking,
                    req.text,
                    wav_path,
                    ref_text,
                ),
                timeout=REQUEST_TIMEOUT,
            )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Synthesis timed out after {REQUEST_TIMEOUT:.0f}s",
        )
    except Exception as exc:
        log.exception("Synthesis error")
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(
        content=pcm_bytes,
        media_type="audio/pcm",
        headers={
            "X-Sample-Rate": str(SAMPLE_RATE),
            "X-Channels": "1",
            "X-Bit-Depth": "16",
            "Cache-Control": "no-store",
        },
    )


@app.get("/voices")
async def list_voices():
    wavs   = sorted(VOICES_DIR.glob("*.wav"))
    voices = []
    for w in wavs:
        profile = _voice_profiles.get(w.stem, {})
        voices.append({
            "id":        w.stem,
            "file":      str(w),
            "ref_text":  profile.get("ref_text", ""),
            "language":  profile.get("language", "eu"),
            "has_profile": w.stem in _voice_profiles,
        })
    return {
        "voices":    voices,
        "voices_dir": str(VOICES_DIR.resolve()),
        "count":     len(voices),
        "model":     F5_MODEL_TYPE,
        "nfe_step":  F5_NFE_STEP,
    }


@app.get("/health")
async def health():
    import torch

    wavs  = [f.stem for f in sorted(VOICES_DIR.glob("*.wav"))]
    ready = _f5_model is not None

    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status":          "ready" if ready else "loading",
            "model_loaded":    ready,
            "model":           F5_MODEL_TYPE,
            "nfe_step":        F5_NFE_STEP,
            "device":          "cuda" if torch.cuda.is_available() else "cpu",
            "voices":          wavs,
            "profiles_loaded": list(_voice_profiles.keys()),
            "sample_rate":     SAMPLE_RATE,
            "max_text_chars":  MAX_TEXT_CHARS,
            "request_timeout": REQUEST_TIMEOUT,
        },
    )


@app.post("/reload-profiles")
async def reload_profiles():
    """Hot-reload voice_profiles.json without restarting the server."""
    global _voice_profiles
    _voice_profiles = _load_voice_profiles()
    return {"ok": True, "profiles": list(_voice_profiles.keys())}


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
