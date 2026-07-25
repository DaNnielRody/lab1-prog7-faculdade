# API

The HTTP surface. An audio file arrives as `multipart/form-data`, is validated, transcoded,
stored and recorded; the same area then serves metadata, the stored bytes, and the summary.
Source: HTTP request → sink: `AudioFileDto` JSON / file stream.

Files:
- `src/AudioApi/Program.cs` — DI, options binding, Kestrel/Form body limits, Swagger, `/health`.
- `src/AudioApi/Endpoints/AudioEndpoints.cs` — all `/api/audios` routes.
- `src/AudioApi/Validation/AudioFileValidator.cs` — pre-transcode rejection.
- `src/AudioApi/Dtos/AudioFileDto.cs`, `src/AudioApi/Dtos/AudioSummaryDto.cs`.
- `src/AudioApi/Options/UploadOptions.cs`.

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
The audio passed validation but `ffmpeg` could not decode it → **422 Unprocessable Entity**.
Distinct from a validation error (**400**).
_Avoid_: invalid file, bad request

**AudioFileDto**:
The full metadata projection of an `AudioFile`, including the summary fields.
_Avoid_: AudioResponse, AudioModel

**AudioSummaryDto**:
The narrow projection returned by `GET /api/audios/{id}/summary` — status, summary text,
its length, language, error, timestamp. Exists so a client can poll the summary without
re-fetching all metadata.
_Avoid_: SummaryResponse, TranscriptDto

## Relationships

- An **Upload** produces exactly one **AudioFile** row and enqueues exactly one
  **summarization job**.
- The **Upload** response always reports `summaryStatus = Pending` (or `Disabled`) — the
  summary is never ready inside the request. Clients poll `GET /api/audios/{id}/summary`.
- `MaxSizeBytes` (`UploadOptions`) drives the Kestrel `MaxRequestBodySize` and the
  `FormOptions.MultipartBodyLengthLimit`, both set to `MaxSizeBytes + 1 MiB` in `Program.cs`.

## Routes

| Method | Route | Notes |
|--------|-------|-------|
| POST | `/api/audios` | 201 / 400 validation / 422 undecodable |
| GET | `/api/audios` | list, newest first |
| GET | `/api/audios/{id:guid}` | 200 `AudioFileDto` / 404 |
| GET | `/api/audios/{id:guid}/download` | streams the stored `.m4a` / 404 |
| GET | `/api/audios/{id:guid}/summary` | 200 `AudioSummaryDto` / 404 |
| GET | `/health` | liveness |

## Flagged ambiguities

- "summary length" always means **characters** (`string.Length`, UTF-16 code units), never
  words or tokens. The 500 ceiling is a character ceiling.
- 400 vs 422 is a real distinction and load-bearing in tests — do not collapse them.
