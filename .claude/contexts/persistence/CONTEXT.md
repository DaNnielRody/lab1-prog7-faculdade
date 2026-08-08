# Persistence

EF Core over SQLite holding one metadata row per uploaded audio. Source: `AudioFile` entity
written by the upload endpoint and updated by the summarization worker → sink: `audios.db`.

Files:
- `src/AudioApi/Data/AppDbContext.cs` — `DbSet<AudioFile> AudioFiles`, `OnModelCreating` constraints.
- `src/AudioApi/Models/AudioFile.cs` — the entity.
- `Program.cs` — `AddDbContext` (scoped), `EnsureCreated()`, `EnsureDatabaseDirectory`.

## Language

**AudioFile**:
The metadata row. Key `Id` (`Guid`, also the file-store key). Columns: `OriginalFileName`,
`StoredFileName`, `Url`, `ContentType`, `SizeBytes`, `CreatedAtUtc`, the **processing** columns
`ProcessingStatus`, `ProcessingError`, `ProcessingUpdatedAtUtc`, and the summary columns
`Summary`, `SummaryStatus`, `SummaryLanguage`, `SummaryError`, `SummaryUpdatedAtUtc`.
`StoredFileName`/`ContentType`/`SizeBytes`/`Url` are **rewritten in place** by the compression
worker when the original is replaced by the `.m4a` — they are not immutable after insert.
_Avoid_: Audio, AudioEntity, Record

**ProcessingStatus**:
`Pending | Processing | Completed | Failed`, persisted as a string like `SummaryStatus`. Tracks
**compression**, which is mandatory — hence no `Disabled` member, and hence `Pending = 0` so the
enum's zero value is the truthful state for a freshly inserted row.
_Avoid_: status (unqualified), CompressionStatus, state

**EnsureCreated**:
Schema creation at startup — **there are no migrations**. Consequence: adding a column does
**not** alter an existing `data/audios.db`; a stale dev DB must be deleted. Say so in the PR.
_Avoid_: migrate, migration

**SummaryStatus**:
`Pending | Processing | Completed | Failed | Disabled`, persisted **as a string**
(`.HasConversion<string>()`) so the DB stays readable and reordering the enum can't corrupt
existing rows.
_Avoid_: state, summary_state, int status

## Relationships

- One **AudioFile** ↔ one stored file (via `StoredFileName`) ↔ at most one summary
  (inline columns, not a separate table — one summary per audio, always).
- `AppDbContext` is **scoped**. The request scope is gone by the time a background worker
  runs, so **each** worker creates its own scope (`IServiceScopeFactory`) and its own context.
- Two background workers now write this table (compression, then summarization) plus the request
  path. `src/AudioApi/Data/IDbWriteGate.cs` + `DbWriteGate.cs` — a singleton `SemaphoreSlim(1,1)` —
  serializes the background `SaveChangesAsync` calls, because **SQLite admits one writer**.
  The gate wraps only the save; never the compression, the file I/O or the Whisper call.
  `UploadAsync` does not use it (one save per request, and the wait would land on the request thread).

## Flagged ambiguities

- Column lengths are declared in `OnModelCreating`, not by attributes — keep new columns there.
  `Summary` is capped at 500 (`HasMaxLength(500)`), mirroring the domain ceiling.
- SQLite admits a single writer. That stopped being free once compression got its own worker
  with `Processing:MaxConcurrency` > 1 — `DbWriteGate` is what keeps it true now, not luck.
- The `.m4a` is written to the store **before** the row is committed, and the original is deleted
  **after**. The invariant being protected: *the file the row points at exists at every instant*,
  so `GET /{id}/download` never 404s mid-pipeline. Reversing that order reintroduces a real,
  measured race (~1 failure in 10 runs).
