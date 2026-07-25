# Summarization

Turns a stored audio file into a short text summary (**≤ 500 characters, hard guarantee**) using a
lightweight local AI model (Whisper) running on a private worker. Source: the stored `.m4a` bytes
→ sink: the `Summary`/`SummaryStatus`/`SummaryLanguage` columns of the `AudioFile` row.

**This is the area that introduced threading to the project.** Compression is fast and
out-of-process (see [Compression](../compression/CONTEXT.md)); summarization is slow, remote and
failure-prone, so it runs off the request thread on a bounded queue. Rationale:
`docs/week3-threading-explanation.md`.

Files:
- `src/AudioApi/Summarization/IAudioSummarizer.cs` — contract + `AudioSummary` record.
- `src/AudioApi/Summarization/WhisperAudioSummarizer.cs` — HTTP client for the worker.
- `src/AudioApi/Summarization/SummaryTruncator.cs` — the ≤ 500 guarantee (pure, no I/O).
- `src/AudioApi/Summarization/ISummaryQueue.cs`, `SummaryQueue.cs` — bounded `Channel<Guid>`.
- `src/AudioApi/Summarization/AudioSummaryBackgroundService.cs` — the consumer.
- `src/AudioApi/Models/SummaryStatus.cs` — the state enum.
- `src/AudioApi/Options/SummarizationOptions.cs`.
- `worker/audio-summary-worker/` — the Python/FastAPI + faster-whisper worker (deployed to the VPS).

## Language

**Summary**:
The ≤ 500-character Portuguese/original-language text stored on the `AudioFile` row. It is
derived from the **transcript**, never equal to it. Length is measured in **characters**
(`string.Length`).
_Avoid_: transcript, description, caption, resumo (in code identifiers)

**Transcript**:
The full verbatim speech-to-text output from Whisper. It lives only inside the worker and is
**never persisted** by the API — only its summary is. Can be tens of thousands of characters.
_Avoid_: text, transcription result, summary

**Summarization job**:
One `Guid` on the `ISummaryQueue` channel. Enqueued by the upload endpoint, consumed by
`AudioSummaryBackgroundService`. Carries only the id — the worker re-reads bytes and DB state.
_Avoid_: task, message, event

**SummaryStatus**:
`Pending` (queued) → `Processing` (worker running) → `Completed` | `Failed`.
`Disabled` when `Summarization:Enabled` is false — the audio was never queued, and that is not
an error.
_Avoid_: state, phase

**Summary worker**:
The out-of-process HTTP service (`worker/audio-summary-worker/`) that owns the Whisper model.
The API is a thin client; it holds no model and no Python.
_Avoid_: whisper, server, backend, transcriber

**Clamp**:
`SummaryTruncator.Clamp(text, maxChars)` — collapses whitespace, then cuts at the last sentence
boundary that fits, else the last word boundary, else hard-cuts; appends `…` only when it
actually truncated **and** counting the `…` itself. Post-condition:
`result.Length <= maxChars`, always, for any input including `null`.
_Avoid_: truncate, trim, cut (as identifiers — `Trim` means whitespace only)

## Relationships

- One **AudioFile** has at most one **Summary** (inline columns, not a table).
- **API → queue → background service → worker → Persistence.** The upload response never
  contains a summary; it reports `Pending`.
- The background service resolves a **fresh DI scope** per job (`IServiceScopeFactory`) because
  `AppDbContext` is scoped and the request scope is long gone.
- The background service reads bytes via `IFileStore.OpenReadAsync` (singleton, safe) —
  it does **not** receive the upload stream.
- Concurrency is capped by `Summarization:MaxConcurrency` (default **1**): the worker VPS has
  4 cores and the API must not be able to stampede it.

## The 500-character guarantee (defence in depth)

Enforced at **three** independent layers, on purpose:
1. **Worker** — builds the summary under its own `max_chars` budget.
2. **`SummaryTruncator.Clamp`** — applied by `WhisperAudioSummarizer` to whatever the worker
   returned, so a buggy/updated/malicious worker cannot exceed the ceiling.
3. **Database** — `Summary` column is `HasMaxLength(500)`.

Layer 2 is the one that is unit-tested and the one that must never be removed: it is the only
layer that holds when the worker is replaced.

## Flagged ambiguities

- "500" lives in `SummarizationOptions.MaxSummaryChars` (default 500). Tests assert the
  **effective** value is ≤ 500 and that `Clamp` honours arbitrary ceilings; the domain ceiling
  itself is 500 and the DB column is fixed at 500 — raising the option above 500 needs an ADR
  and a schema change.
- `Summarization:Enabled` defaults to **false** so `dotnet test`, CI and the sandbox gate never
  need the VPS or the network. Enable it via `appsettings.Development.json` / env vars.
- Failures are **not retried** today. A `Failed` row keeps its `SummaryError` and stays failed;
  re-uploading is the workaround. Retry/backoff is a deliberate deferral, documented in
  `docs/week3-threading-explanation.md`.
