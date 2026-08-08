# Compression

Transcodes a stored upload to AAC, by shelling out to `ffmpeg`. Source: the **stored original**
`Stream` → sink: a `CompressedAudio` whose `Stream` is a self-deleting temp file.

**Since week 4 this runs off the request thread**, in its own queue + `BackgroundService`, for the
same reason summarization does: `ffmpeg` costs roughly linear time in input size (~2.8s for 42 MB),
and nothing capped how many ran at once. Rationale and measurements:
`docs/week4-threading-pipeline.md`.

Files:
- `src/AudioApi/Compression/IAudioCompressor.cs` — contract + `CompressedAudio` record.
- `src/AudioApi/Compression/FfmpegAudioCompressor.cs` — `Process`-based implementation (singleton).
- `src/AudioApi/Options/CompressionOptions.cs` — `FfmpegPath`, `BitrateKbps`.
- `src/AudioApi/Processing/IProcessingQueue.cs`, `ProcessingQueue.cs` — bounded `Channel<Guid>`.
- `src/AudioApi/Processing/AudioProcessingBackgroundService.cs` — the consumer.
- `src/AudioApi/Models/ProcessingStatus.cs`, `src/AudioApi/Options/ProcessingOptions.cs`.

## Language

**CompressedAudio**:
`(Stream, Extension, ContentType)` = `(temp .m4a file stream, ".m4a", "audio/mp4")`.
The `Stream` is opened with `FileOptions.DeleteOnClose` — **disposing it deletes the file**, so
callers must consume it before disposal and must not re-read it afterwards.
_Avoid_: TranscodeResult, output

**Transcode**:
The `ffmpeg -c:a aac -b:a {n}k -movflags +faststart` run. Non-zero exit → logged with stderr and
rethrown as `InvalidOperationException`.
_Avoid_: convert, encode, compress (as a verb for the whole pipeline)

**Out-of-process work**:
The AAC encoding runs in a separate **OS process**, awaited with
`Process.WaitForExitAsync(ct)`, so no thread is blocked while it runs. Note what this does *not*
buy: `await` releases the thread but does not shorten the response — that distinction is why
week 2's "no threading needed" was right about thread occupancy and wrong about response latency
once inputs got large (`docs/week4-threading-pipeline.md`).
_Avoid_: background work (that term now means a queue + `BackgroundService`, of which there are two)

**Compression job**:
One `Guid` on the `IProcessingQueue` channel. Enqueued by the upload endpoint after the row is
saved, consumed by `AudioProcessingBackgroundService`. Carries only the id — the worker re-reads
the bytes from the store and the state from the DB.
_Avoid_: task, message, event

## Relationships

- **API → queue → compression worker → Storage → Persistence → summary queue.** The upload
  response never reflects compression; it reports `ProcessingStatus = Pending`.
- The worker resolves a **fresh DI scope** per job (`AppDbContext` is scoped) and reads bytes via
  `IFileStore.OpenReadAsync` — it never receives the request's stream.
- `InvalidOperationException` from here is no longer a 422. It becomes `ProcessingStatus = Failed`
  + `ProcessingError` on the row, and `SummaryStatus = Failed` too, since there will never be an
  `.m4a` to summarize.
- **Concurrency** is capped by `Processing:MaxConcurrency` (default `Environment.ProcessorCount`):
  `ffmpeg` is CPU-bound and in-process, so more runs than cores makes every run slower and starves
  the thread pool serving HTTP.

## Flagged ambiguities

- `ffmpeg` must be on `PATH` (or `Compression:FfmpegPath`). Both the app Dockerfile and the
  sandbox test image install it — a missing binary looks exactly like a decode failure.
- Temp files: input via `Path.GetTempFileName()` deleted in `finally`; output deleted by
  `DeleteOnClose` or by the `catch`. Any new path through this class must preserve both.
- `ProcessingOptions.MaxConcurrency` is `int?`, and `EffectiveMaxConcurrency` treats null / absent /
  `<= 0` as **"the machine decides"** (`Environment.ProcessorCount`). That shape exists so
  `appsettings.json` can carry `"MaxConcurrency": 0` and document the knob without pinning every
  host to a fixed number. Always read `EffectiveMaxConcurrency`, never the raw property. Tests force
  a real value via `Processing__MaxConcurrency` so CI does not depend on the runner's core count.
  `SummarizationOptions.MaxConcurrency` is deliberately **not** shaped this way — its default of 1
  is about the remote VPS, not about this host.
- Failures are **not retried**, same as summarization. A `Failed` row stays failed; re-uploading is
  the workaround.
