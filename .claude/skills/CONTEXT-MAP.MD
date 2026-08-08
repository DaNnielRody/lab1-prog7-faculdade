# Context Map — Prog7 (Audio Upload API)

Global project context for dark-factory runs and grilling sessions. Authoritative planning
document for this repo: every `/darkagent` run opens this file first.

## Stack (discovered)

- **Backend**: C# / .NET 10 (`net10.0`), ASP.NET Core **Minimal APIs**. Entry point
  `src/AudioApi/Program.cs`. Solution `Prog7.slnx`.
- **Frontend**: **Next.js (App Router) + TypeScript + Tailwind v4** in `web/`, tests with
  Vitest + React Testing Library. No component/state/HTTP library — platform + React only.
  Visual source of truth: **`docs/DESIGN.md`** (produced by `/darkdesign`).
  → `df-frontend` and `df-design` **are** generated for this repo.
- **Data**: EF Core 10 + **SQLite** (`src/AudioApi/Data/AppDbContext.cs`), schema created via
  `db.Database.EnsureCreated()` — **no migrations folder**.
- **External processes**: `ffmpeg` binary (audio → AAC), Whisper worker over HTTP
  (audio → transcript + summary).
- **Tests**: **xUnit** in `tests/AudioApi.Tests/`. Integration via
  `WebApplicationFactory<Program>`. No mocking library — hand-written fakes
  (`FakeAudioSummarizer`, `DelegatingHandler` stubs) and `NullLogger<T>.Instance`.
- **Git**: default branch `main`; merged PRs target `main` → **PR target = `main`**.
  Because `main` is the default branch, GitHub auto-closes `Closes #n`;
  the `darkagent-close-issues.yml` workflow from CONTEXT-REPO §5 is intentionally **not**
  installed here.

## Contexts

- [API](../contexts/api/CONTEXT.md) — HTTP surface: upload, metadata, download, summary. Validation + ProblemDetails.
- [Storage](../contexts/storage/CONTEXT.md) — `IFileStore` binary persistence + resolvable URL.
- [Compression](../contexts/compression/CONTEXT.md) — `IAudioCompressor`, ffmpeg → AAC/`.m4a`, on its own background queue.
- [Summarization](../contexts/summarization/CONTEXT.md) — `IAudioSummarizer` + background queue → Whisper worker.
- [Persistence](../contexts/persistence/CONTEXT.md) — EF Core/SQLite, `AudioFile` entity.
- [Frontend](../contexts/frontend/CONTEXT.md) — Next.js client in `web/`: upload, phase machine, thread, player.

## Relationships

- **API → Storage → Persistence**: `UploadAsync` validates, writes the **original** bytes, saves
  the `AudioFile` row (`ProcessingStatus = Pending`) and returns 201. It runs no ffmpeg.
- **API → Compression**: upload enqueues the audio id on `IProcessingQueue`; the request does
  **not** wait. The worker transcodes, replaces the stored file with the `.m4a`, rewrites
  `StoredFileName`/`ContentType`/`SizeBytes`/`Url`, commits, then deletes the original.
- **Compression → Summarization**: the compression worker enqueues the summarization job, and
  only after its own commit — nothing is summarizable before the `.m4a` exists. A compression
  failure writes `SummaryStatus = Failed` directly and enqueues nothing.
- **Both workers → Storage**: they re-read bytes through `IFileStore.OpenReadAsync` — they never
  receive the request's stream (request scope is gone).
- **Both workers → Persistence**: each owns its own DI scope + `AppDbContext`, and both route
  `SaveChangesAsync` through `IDbWriteGate` (SQLite admits one writer).
- **Frontend → API**: the browser uploads to `POST /api/audios` and polls
  `GET /api/audios/{id}/summary`. Cross-origin, so the API carries a CORS policy
  (`Options/CorsOptions.cs`); without an allowed origin every call dies pre-handler.
- **Frontend → docs/DESIGN.md**: every visual value resolves to a token there. Design gaps are
  fixed in that document (or a new `/darkdesign` pass), never improvised in TSX.

## Engineering policy (Conservador — dark-factory default)

- **Replicate existing patterns**, don't invent:
  - Feature = folder per concern: `Compression/`, `Storage/`, `Validation/`, `Summarization/`,
    `Processing/`.
  - Background work = bounded `Channel<Guid>` behind an interface + a `BackgroundService` with a
    `SemaphoreSlim` cap, a fresh DI scope per job, and a per-job `try/catch` so one failure never
    kills the loop. Two instances of this pattern exist (`Processing/`, `Summarization/`);
    a third should look the same.
  - Interface + one implementation per concern (`IFileStore`/`LocalFileStore`,
    `IAudioCompressor`/`FfmpegAudioCompressor`, `IAudioSummarizer`/`WhisperAudioSummarizer`).
  - Config through `Options/<X>Options.cs` with `public const string SectionName`, bound in
    `Program.cs` via `builder.Services.Configure<T>(...GetSection(T.SectionName))`, consumed as
    `IOptions<T>` and stored as `_options = options.Value` in the ctor.
  - Endpoints are `private static` handlers in `Endpoints/AudioEndpoints.cs`, registered in
    `MapAudioEndpoints` with `.WithName`/`.WithSummary`/`.Produces`.
  - Errors: `Results.Problem(title:, detail:, statusCode:)` for the upload path,
    `TypedResults` where the handler has a closed return union.
  - DTOs are `sealed record` with a static `FromEntity`.
  - User-facing strings (`title`, `detail`, log messages) are **Portuguese** — keep it.
- **No new dependencies without an ADR.** Everything so far is BCL + EF Core + Swashbuckle.
  Prefer `IHttpClientFactory`, `System.Text.Json`, `System.Threading.Channels` over packages.
- **Minimal diff during implementation**; improvement belongs to the quality batch (always runs).
- **Frontend patterns** (`web/`): one file per `{component.x}` family in `components/ui/`,
  composites in `components/transcription/`, all HTTP through `lib/api.ts`, all polling through
  `lib/useTranscription.ts`, components are pure functions of props, UI copy Portuguese.
  `docs/DESIGN.md` is the visual source of truth — no raw hex, no raw px, no undocumented state.
- **Tests**: xUnit in `tests/AudioApi.Tests/`; every new unit gets a test file next to its peers.
  Frontend: Vitest + React Testing Library in `web/`; the upload loading state is explicitly
  test-covered (MR requirement).
  Tests must not require network or the VPS — the sandbox gate has neither.
  Sandbox gate must stay green.

## Context write-back (mandatory, before commit)

Every run updates the CONTEXT.md of each area it touched — new terms, changed
contracts/thresholds, new tables/envs/routes, resolved ambiguities — in the
same run, never deferred. A run that changes area behavior without updating
its CONTEXT.md is incomplete. Grill decisions are written back inline as they
land. This rule lives here (context operations), never in the pipeline
SKILL.md (orchestration only).

## Navigation

`codegraph` is **unavailable** in this environment (`@colbymchenry/codegraph` installs an empty
package; no `codegraph` bin). Until it works, navigate by this map + the per-area CONTEXT.md
file lists, then Read the located file. Still no blind repo-wide fan-out greps — the repo is
14 source files and every one is listed in a context doc.
