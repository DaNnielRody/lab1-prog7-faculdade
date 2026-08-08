# Frontend

The browser client for the AudioApi. **One screen, one conversation**: send an audio file, watch the
server work, and read the summary of every audio the server holds — all as messages in the same
thread. Source: a `File` from the user + `GET /api/audios` → sink: rendered thread messages.

The screen is a **chat**, and that is load-bearing. Its source of truth is the Figma
`7HoYbh5Peur8sdpSodTyKC`, page **Screens** (`0:1`): nine frames, none of which is a list, and a
"Chat body" (`5:47`) containing only messages. A requirement of the form "show X for each item"
is satisfied here by **a message**, not by a new region. A separate bordered list was built once,
below the thread, and had to be removed — see `docs/DESIGN.md` §11.

Visual source of truth: **`docs/DESIGN.md`** (tokens + components). Never decide a visual value here.

Files:
- `web/app/page.tsx` — the transcription screen composition.
- `web/app/layout.tsx`, `web/app/globals.css` — fonts + DESIGN.md tokens as CSS variables.
- `web/components/ui/*` — the primitive library (one file per `{component.x}` family).
- `web/components/transcription/*` — screen-level composites (Sidebar, Topbar, Thread, SettingsPanel, PlayerBar, dialogs).
- `web/components/ui/Toast.tsx` — the screen's only transient notice (fixed, claims no layout).
- `web/lib/api.ts` — the only module that talks HTTP to the AudioApi (`uploadAudio`, `getSummary`, `listAudios`).
- `web/lib/useTranscription.ts` — the upload + polling state machine for the current session.
- `web/lib/useProcessedAudios.ts` — the list loader + poller for the processed region.
- `web/lib/types.ts` — TS mirrors of `AudioFileDto` / `AudioSummaryDto`.

## Language

**Transcription session**:
One audio file being carried through upload → queue → transcription → summary, inside a single
screen. The screen holds exactly one at a time. "Recomeçar" clears it locally; nothing server-side
is deleted.
_Avoid_: job, task, conversation

**Thread**:
The vertical list of messages that mirrors the backend state changes. Each backend transition
appends exactly one message row. It is a state log, not a chat with an assistant.
_Avoid_: chat, feed, timeline

**Phase**:
The frontend's own state enum, wider than the API's `SummaryStatus` because it also covers
client-only states: `idle | uploading | pending | processing | completed | failed | disabled`.
`uploading` exists only in the browser (the server knows nothing until the POST lands).
_Avoid_: status (reserved for the API's `SummaryStatus`), step

**Upload progress**:
Real bytes-sent percentage from `XMLHttpRequest.upload.onprogress`. Only ever shown for the
`uploading` phase, because it is the only phase the client can measure.
_Avoid_: loading percent, progress (unqualified)

**Poller**:
The interval that calls `GET /api/audios/{id}/summary` every 2s while the phase is `pending` or
`processing`, and stops on any terminal phase or after the 5-minute ceiling.
_Avoid_: watcher, subscription

**History message**:
An audio the server already holds, rendered as an ordinary message in the thread
(`Thread.renderProcessed`). One message per audio, oldest first, **above** the current session,
with the session's own audio filtered out so it is never told twice. A `Completed` audio renders
the summary bubble; every other state renders the reason (comprimindo / falhou / aguardando o
resumo / desativado) — never an empty body. It is server state, so it survives a reload and
"Recomeçar", and it is read-only: no playback (the player only plays the local `File`), no
download, no retry (the API has no reprocess endpoint).
_Avoid_: list, card, processed list, feed, history panel

**List poller**:
The interval in `useProcessedAudios` that re-fetches every 2s (`POLL_INTERVAL_MS`, shared with
`useTranscription` — one cadence for one set of server transitions) **only while some audio is
non-terminal**, and stops when all are terminal. No 5-minute ceiling: there is no session to time
out. `errorSeq` counts failed attempts, because `error` never returns to `null` between two
consecutive failures and the toast needs a rising edge to restart its dwell.
_Avoid_: refresh, auto-reload

**Toast**:
The screen's only transient notice: `position: fixed`, above the player bar, `role="status"`,
auto-dismiss after 8s with holds on hover / focus / open dialog. It exists so a failure with
nothing to show **claims no layout** — the previous inline treatment drew a divider and a heading
to announce that it had nothing, which reads as debris. One producer today: `GET /api/audios`
failed and the screen holds no history.
_Avoid_: snackbar, alert, banner

## Relationships

- **Frontend → API**: only through `web/lib/api.ts`. Components never call `fetch`/`XHR` directly.
- **Upload → phase**: `POST /api/audios` resolves with `summaryStatus`; `Pending` → phase
  `pending` (start poller), `Disabled` → phase `disabled` (no poller, the server has
  `Summarization:Enabled = false`).
- **Poller → thread**: a phase change appends a message; the same phase polled twice appends
  nothing. Messages are append-only within a session.
- **Frontend → DESIGN.md**: every className resolves to a token variable defined in `globals.css`.
  A visual value with no token is a bug, not a shortcut.
- **API → CORS**: the browser origin must be allowed by `Cors:AllowedOrigins` in the API
  (`src/AudioApi/Options/CorsOptions.cs`). Without it every call fails before reaching a handler.

## Config

| Variable | Default | Meaning |
|----------|---------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:5218` | Base URL of the AudioApi |

The default is the **`dotnet run`** port. Docker Compose publishes the API on **8080**, so running
the client against the compose stack needs `web/.env.local` with
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8080` **and a dev-server restart** — `NEXT_PUBLIC_*` is
inlined at build time, not read per request. Without it the screen shows "API sem resposta" and
looks like an app bug rather than a missing variable.

## Flagged ambiguities

- The API returns **one summary**, never a segmented transcript. The thread must never render
  fake timestamps or speaker turns (`docs/DESIGN.md` §8 Don't 4).
- `Disabled` is not a failure. It renders neutral (idle chip + neutral bubble), never red.
- Upload percentage is measurable; transcription percentage is not. `processing` uses the
  indeterminate bar and the literal word `Processing`.
- The player is playback-only; it plays the **locally selected file** via `URL.createObjectURL`,
  not the stored `.m4a`, so it works before/without a download round-trip. No download UI exists.
  Consequence: a row in the processed list **cannot** be played — the browser has no `File` for it.
- The API now has **two** background stages, so an audio can be `summaryStatus: Pending` while
  nothing is being summarized yet. `processingStatus` takes precedence when choosing what a
  message says: while `ffmpeg` runs there is no `.m4a`, so "resumindo" would be a lie.
- **The empty state and the history come from the same array, in the same component.** That is
  not a style choice — the screen once rendered "Nenhum áudio ainda" directly above two audios,
  because the two lived in different components. Keep them together and the contradiction is
  structurally impossible.
- Any test that renders `TranscriptionScreen` **must mock `listAudios`**. The screen fetches the
  list on mount; without the mock, jsdom issues a real network call whose success depends on
  whether the dev happens to have the API running — which is exactly the flakiness it caused once.
