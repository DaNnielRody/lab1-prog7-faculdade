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
`StoredFileName`, `Url`, `ContentType`, `SizeBytes`, `CreatedAtUtc`, plus the summary columns
`Summary`, `SummaryStatus`, `SummaryLanguage`, `SummaryError`, `SummaryUpdatedAtUtc`.
_Avoid_: Audio, AudioEntity, Record

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
- `AppDbContext` is **scoped**. The request scope is gone by the time the background worker
  runs, so the worker creates its own scope (`IServiceScopeFactory`) and its own context.

## Flagged ambiguities

- Column lengths are declared in `OnModelCreating`, not by attributes — keep new columns there.
  `Summary` is capped at 500 (`HasMaxLength(500)`), mirroring the domain ceiling.
- SQLite has no real concurrency story here; the worker writes one row at a time and the
  summarization concurrency limit keeps that true.
