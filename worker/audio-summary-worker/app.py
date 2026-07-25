import asyncio
import logging
import os
import tempfile
import time

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

from summarizer import summarize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("audio-summary-worker")

MODEL_NAME = os.getenv("WHISPER_MODEL", "tiny")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "4"))
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
API_KEY = os.getenv("WORKER_API_KEY", "")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(64 * 1024 * 1024)))
MAX_CHARS_CEILING = int(os.getenv("MAX_CHARS_CEILING", "500"))

app = FastAPI(title="Audio Summary Worker", version="1.0.0")

_model = None
_model_lock = asyncio.Lock()
_transcribe_lock = asyncio.Lock()


def require_api_key(x_api_key: str = Header(default="")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")


async def get_model():
    global _model
    if _model is None:
        async with _model_lock:
            if _model is None:
                started = time.perf_counter()
                _model = await asyncio.to_thread(
                    WhisperModel,
                    MODEL_NAME,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                    cpu_threads=CPU_THREADS,
                )
                logger.info(
                    "loaded whisper model=%s device=%s compute=%s in %.1fs",
                    MODEL_NAME, DEVICE, COMPUTE_TYPE, time.perf_counter() - started,
                )
    return _model


def transcribe(model, path):
    segments, info = model.transcribe(
        path,
        beam_size=BEAM_SIZE,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments)
    return text, info.language, info.duration


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model_loaded": _model is not None,
        "max_chars_ceiling": MAX_CHARS_CEILING,
    }


@app.post("/summarize", dependencies=[Depends(require_api_key)])
async def summarize_endpoint(file: UploadFile = File(...), max_chars: int = Form(MAX_CHARS_CEILING)):
    limit = max(1, min(max_chars, MAX_CHARS_CEILING))

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes")

    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    path = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(payload)
            path = handle.name

        model = await get_model()

        async with _transcribe_lock:
            started = time.perf_counter()
            try:
                transcript, language, duration = await asyncio.to_thread(transcribe, model, path)
            except Exception as error:
                logger.exception("transcription failed for %s", file.filename)
                raise HTTPException(status_code=422, detail=f"could not transcribe audio: {error}") from error
            elapsed = time.perf_counter() - started

        transcript = transcript.strip()
        if not transcript:
            raise HTTPException(status_code=422, detail="no speech detected in the audio")

        summary = summarize(transcript, limit)
        if len(summary) > limit:
            summary = summary[:limit]

        logger.info(
            "summarized %s in %.1fs: audio=%.1fs lang=%s transcript=%d chars summary=%d/%d chars",
            file.filename, elapsed, duration or 0.0, language, len(transcript), len(summary), limit,
        )

        return {
            "summary": summary,
            "language": language,
            "transcript_chars": len(transcript),
            "duration_seconds": round(duration or 0.0, 2),
            "elapsed_seconds": round(elapsed, 2),
            "model": MODEL_NAME,
        }
    finally:
        if path and os.path.exists(path):
            os.unlink(path)
