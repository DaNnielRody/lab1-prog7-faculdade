# API

The HTTP surface. An audio file arrives as `multipart/form-data`, is validated, transcoded,
stored and recorded; the same area then serves metadata, the stored bytes, and the summary.
Source: HTTP request → sink: `AudioFileDto` JSON / file stream.

Files:
- `src/AudioApi/Program.cs` — DI, options binding, Kestrel/Form body limits, Swagger, `/health`.
- `src/AudioApi/Endpoints/AudioEndpoints.cs` — all `/api/audios` routes.
- `src/AudioApi/Validation/AudioFileValidator.cs` — pre-transcode rejection.
- `src/AudioApi/Dtos/AudioFileDto.cs`, `src/AudioApi/Dtos/AudioSummaryDto.cs`.
- `src/AudioApi/Options/UploadOptions.cs`, `src/AudioApi/Options/CorsOptions.cs`.

## Language

**Upload**:
A single `POST /api/audios` request carrying one audio file in the form field `file`.
Returns **201 Created** with `Location: /api/audios/{id}` and the `AudioFileDto`.
_Avoid_: import, ingest, post

**Validation error**:
A human-readable Portuguese sentence returned by `AudioFileValidator.Validate` — `null` means
valid. It is a *pre-flight* check on name/content-type/size only; it never decodes the audio.
_Avoid_: ValidationResult, error code

**Decode failure**:
The audio passed validation but `ffmpeg` could not decode it. **Since week 4 this is no longer a
422** — the request does not decode anything, so it cannot know. It surfaces as
`ProcessingStatus = Failed` + `ProcessingError` on the row (and `SummaryStatus = Failed`), while
the upload itself stays **201**. Same treatment week 3 gave summarization failures, same reason.
_Avoid_: invalid file, bad request, 422

**AudioFileDto**:
The full metadata projection of an `AudioFile`, including the summary fields.
_Avoid_: AudioResponse, AudioModel

**AudioSummaryDto**:
The narrow projection returned by `GET /api/audios/{id}/summary` — status, summary text,
its length, language, error, timestamp. Exists so a client can poll the summary without
re-fetching all metadata.
_Avoid_: SummaryResponse, TranscriptDto

**CORS policy**:
The named policy `CorsOptions.PolicyName` ("Frontend"), bound from the `Cors` section and applied
with `app.UseCors(...)` before the endpoints. It allows only the origins listed in
`Cors:AllowedOrigins` (default `http://localhost:3000`, the Next.js client), any header, any
method — no wildcard, no credentials. Without an allowed origin the browser request dies before
reaching a handler.
_Avoid_: cors config, allow-all

## Relationships

- An **Upload** produces exactly one **AudioFile** row and enqueues exactly one **compression
  job**. The *summarization* job is enqueued later, by the compression worker, only after
  compression commits — nothing can be summarized before the `.m4a` exists.
- The **Upload** response always reports `processingStatus = Pending` and
  `summaryStatus = Pending` (or `Disabled`). Neither the `.m4a` nor the summary exists inside the
  request: the response still carries the **original** `storedFileName`/`contentType`/`sizeBytes`.
  Clients poll `GET /api/audios/{id}` or `GET /api/audios/{id}/summary`, both of which carry
  `processingStatus`.
- `MaxSizeBytes` (`UploadOptions`) drives the Kestrel `MaxRequestBodySize` and the
  `FormOptions.MultipartBodyLengthLimit`, both set to `MaxSizeBytes + 1 MiB` in `Program.cs`.

## Routes

| Method | Route | Notes |
|--------|-------|-------|
| POST | `/api/audios` | 201 / 400 validation. **No 422** — undecodable audio fails in the background |
| GET | `/api/audios` | list, newest first. Consumed by the web client's "Áudios processados" list |
| GET | `/api/audios/{id:guid}` | 200 `AudioFileDto` / 404 |
| GET | `/api/audios/{id:guid}/download` | streams whatever the row points at — the original while `ProcessingStatus` is `Pending`/`Processing`, the `.m4a` after / 404 |
| GET | `/api/audios/{id:guid}/summary` | 200 `AudioSummaryDto` / 404 |
| GET | `/health` | liveness |

Todas as rotas respondem sob a política de CORS `Frontend` (origens de `Cors:AllowedOrigins`).

## Flagged ambiguities

- "summary length" always means **characters** (`string.Length`, UTF-16 code units), never
  words or tokens. The 500 ceiling is a character ceiling.
- 400 is still load-bearing: `AudioFileValidator` is a pre-flight check on name/content-type/size
  that decodes nothing, so it stays inside the request. **422 is gone from this API** — do not
  reintroduce it on the upload path without moving decoding back into the request, which is the
  whole thing week 4 undid.
- `GET /{id}/download` must never 404 for a row that exists and is mid-pipeline. The compression
  worker guarantees this by committing the row *before* deleting the original.
