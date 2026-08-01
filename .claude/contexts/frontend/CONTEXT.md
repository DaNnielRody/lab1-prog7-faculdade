# Frontend

The browser client for the AudioApi. One screen: send an audio file, watch the server work, read
the ≤500-character summary. Source: a `File` from the user → sink: rendered thread messages.

Visual source of truth: **`docs/DESIGN.md`** (tokens + components). Never decide a visual value here.

Files:
- `web/app/page.tsx` — the transcription screen composition.
- `web/app/layout.tsx`, `web/app/globals.css` — fonts + DESIGN.md tokens as CSS variables.
- `web/components/ui/*` — the primitive library (one file per `{component.x}` family).
- `web/components/transcription/*` — screen-level composites (Sidebar, Topbar, Thread, SettingsPanel, PlayerBar, dialogs).
- `web/lib/api.ts` — the only module that talks HTTP to the AudioApi.
- `web/lib/useTranscription.ts` — the upload + polling state machine.
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

## Flagged ambiguities

- The API returns **one summary**, never a segmented transcript. The thread must never render
  fake timestamps or speaker turns (`docs/DESIGN.md` §8 Don't 4).
- `Disabled` is not a failure. It renders neutral (idle chip + neutral bubble), never red.
- Upload percentage is measurable; transcription percentage is not. `processing` uses the
  indeterminate bar and the literal word `Processing`.
- The player is playback-only; it plays the **locally selected file** via `URL.createObjectURL`,
  not the stored `.m4a`, so it works before/without a download round-trip. No download UI exists.
