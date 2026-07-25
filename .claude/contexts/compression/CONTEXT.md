# Compression

Transcodes any accepted upload to AAC before it is stored, by shelling out to `ffmpeg`.
Source: the request's upload `Stream` → sink: a `CompressedAudio` whose `Stream` is a
self-deleting temp file.

Files:
- `src/AudioApi/Compression/IAudioCompressor.cs` — contract + `CompressedAudio` record.
- `src/AudioApi/Compression/FfmpegAudioCompressor.cs` — `Process`-based implementation (singleton).
- `src/AudioApi/Options/CompressionOptions.cs` — `FfmpegPath`, `BitrateKbps`.

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
`Process.WaitForExitAsync(ct)` — the ASP.NET Core thread is released while it runs. This is why
compression needed no threading of its own (see `docs/week2-analysis.md`).
_Avoid_: background work (that term is reserved for Summarization's queue)

## Relationships

- **API → Compression → Storage**: `UploadAsync` awaits `CompressToAacAsync`, then hands
  `compressed.Stream` to `IFileStore.SaveAsync` inside `await using (compressed.Stream)`.
- `InvalidOperationException` from here is the *only* source of the API's 422.

## Flagged ambiguities

- `ffmpeg` must be on `PATH` (or `Compression:FfmpegPath`). Both the app Dockerfile and the
  sandbox test image install it — a missing binary looks exactly like a decode failure.
- Temp files: input via `Path.GetTempFileName()` deleted in `finally`; output deleted by
  `DeleteOnClose` or by the `catch`. Any new path through this class must preserve both.
