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
- [Compression](../contexts/compression/CONTEXT.md) — `IAudioCompressor`, ffmpeg → AAC/`.m4a`.
- [Summarization](../contexts/summarization/CONTEXT.md) — `IAudioSummarizer` + background queue → Whisper worker.
- [Persistence](../contexts/persistence/CONTEXT.md) — EF Core/SQLite, `AudioFile` entity.
- [Frontend](../contexts/frontend/CONTEXT.md) — Next.js client in `web/`: upload, phase machine, thread, player.

## Relationships

- **API → Compression → Storage → Persistence**: `UploadAsync` validates, transcodes to AAC,
  writes the compressed bytes only, then saves the `AudioFile` row.
- **API → Summarization**: upload enqueues the audio id; the request does **not** wait.
  `GET /api/audios/{id}` and `/{id}/summary` read the summary state the worker wrote back.
- **Summarization → Storage**: the background worker re-reads the stored `.m4a` through
  `IFileStore.OpenReadAsync` — it never receives the request's stream (request scope is gone).
- **Summarization → Persistence**: the worker owns its own DI scope + `AppDbContext`
  (the request's scoped context is disposed by then).
- **Frontend → API**: the browser uploads to `POST /api/audios` and polls
  `GET /api/audios/{id}/summary`. Cross-origin, so the API carries a CORS policy
  (`Options/CorsOptions.cs`); without an allowed origin every call dies pre-handler.
- **Frontend → docs/DESIGN.md**: every visual value resolves to a token there. Design gaps are
  fixed in that document (or a new `/darkdesign` pass), never improvised in TSX.

## Engineering policy (Conservador — dark-factory default)

- **Replicate existing patterns**, don't invent:
  - Feature = folder per concern: `Compression/`, `Storage/`, `Validation/`, `Summarization/`.
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
