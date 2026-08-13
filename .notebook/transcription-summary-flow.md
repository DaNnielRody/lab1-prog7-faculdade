# Transcription and Summary Flow
> The worker discards the full Whisper transcript after deriving an extractive summary

Entry: `worker/audio-summary-worker/app.py:summarize_endpoint()` (L79-131)
Flow: upload compressed audio → `get_model()` → `transcribe()` → `summarize()` → JSON response → .NET client → SQLite summary fields

Transcription: `worker/audio-summary-worker/app.py:transcribe()` (L56-64)
- `faster-whisper`; model/configuration from environment
- VAD enabled; `condition_on_previous_text=False`; no word timestamps or confidence retained
- Joins all segments into one string; segment boundaries and timestamps discarded

Post-processing: `worker/audio-summary-worker/summarizer.py:summarize()` (L81-109)
- Extractive frequency scoring with pt/en/es stopwords
- Chosen sentences emitted in original order; hard-clamped to 500 chars
- No LLM, glossary, correction audit, or selective retranscription

Boundary: `src/AudioApi/Summarization/WhisperAudioSummarizer.cs:SummarizeAsync()` (L28-91)
- Worker response contract carries summary, language, transcript character count, and model
- API clamps the summary again; does not receive transcript or segments

Persistence: `src/AudioApi/Models/AudioFile.cs` (L25-33)
- Stores summary, language, status/error/update time
- No transcript, ASR model/version, duration, confidence, or correction provenance

Implication: transcript quality cannot be inspected, searched, corrected, or re-summarized without running Whisper again.

Updated: 2026-08-13
