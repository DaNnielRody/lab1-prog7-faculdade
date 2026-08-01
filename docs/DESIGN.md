# Prog7 — Audio Summary Studio · DESIGN.md

> Single source of truth for the frontend of the Prog7 audio API. Every visual value in this
> document resolves to a token defined here. Figma reference file:
> <https://www.figma.com/design/7HoYbh5Peur8sdpSodTyKC> — page **Screens** (5 states + 4 modals),
> page **Foundations** (token sheet).

---

## 1. Overview

Prog7 is a tool, not a landing page. It has exactly one job: you hand it an audio file, the server
compresses it, a local Whisper worker transcribes it out-of-band, and a ≤500-character extractive
summary comes back. The interface is built around the only thing that is genuinely hard about that
job — **the wait**. Upload is instant; transcription is not. So the product is shaped like a
conversation: a chat thread where each backend state (`Pending` → `Processing` → `Completed` |
`Failed`) arrives as its own message, and the summary is the last message in the thread. Nothing is
hidden behind a spinner that says nothing.

The chrome is borrowed from the two references the product was designed against: a near-black
navigation rail that never changes, wrapping a bright working surface that does. That split is the
system's signature — **dark chrome, light work**. The rail carries identity and destination; the
white canvas carries content and state; the muted right panel carries controls. A user always knows
which of the three they are looking at, because the three never trade surfaces.

Color is scarce on purpose. There is exactly one brand hue — an orange lifted from the reference —
and it is allowed to appear only where the product is *doing something for you*: the active nav
marker, the upload progress fill, the played portion of the waveform, the primary button, the
accent rail on the summary. Every other pixel is grey. The result is that on any screen you can
point at the orange and say what the app is currently working on. State that is not brand state
(queued, processing, done, failed) uses a small semantic palette, and it appears as a soft-tinted
chip or bubble — never as a full-bleed colored region.

The system is deliberately small: two typefaces, nine type tokens, four radii, one shadow, one
accent. That restraint is what makes the interface readable at a glance while five different
backend states cycle through it.

**Key Characteristics**

- **Dark rail, light canvas, muted panel** — three fixed surfaces, never interchanged.
- **State-as-conversation** — every backend transition is a message row, not a toast.
- **One accent, split by role** — `{colors.brand.primary}` for graphics, `{colors.brand.text}` for
  anything that is text or a glyph. No orange value is used where it fails contrast.
- **Progress is always quantified** — a bar plus a number plus the literal API state name
  (`Pending`, `Processing`, `Completed`, `Failed`) so the UI and the API vocabulary match.
- **Hairlines, not shadows** — the only shadow in the system belongs to the modal dialog.
- **Monospace is a first-class citizen** — ids, byte counts, durations, status enums and character
  counts are all mono, because they are data, not prose.
- **The 500-character ceiling is visible** — the limit is a domain invariant of the API, so the UI
  shows `201 / 500 caracteres`, never a bare paragraph.
- **Copy is Portuguese, tokens and code are English** — matching the repository's existing docs.

---

## 2. Colors

Measured contrast ratios are stated for every pair the system actually renders. All values were
computed against the sRGB WCAG formula; each ratio quoted below is a fact about these two hexes,
not an aspiration.

### Brand & Accent

| Name | Token | Hex | Role |
|------|-------|-----|------|
| Signal Orange | `{colors.brand.primary}` | `#FF5A1F` | Filled controls, progress fills, active nav marker, played waveform. **3.12:1 on `{colors.surface.canvas}`** — legal as a graphical object (SC 1.4.11), never used for text. |
| Signal Orange Pressed | `{colors.brand.pressed}` | `#EC4C17` | Pressed state of any `{colors.brand.primary}` fill. |
| Deep Orange | `{colors.brand.text}` | `#B23A0E` | Every orange **text or glyph** on a light surface. 5.99:1 on canvas, 5.43:1 on `{colors.brand.soft}`, 5.59:1 on `{colors.surface.muted}`. |
| Orange Wash | `{colors.brand.soft}` | `#FFF1EA` | Tint behind orange glyph circles, badges, drag-over dropzone. |

The two dark-orange/vivid-orange values are a **pair, not a duplicate**: the vivid one is legal only
as a shape, the deep one is legal everywhere text goes. The token layer cannot express "large text
only", so the system carries two values instead of one conditional rule.

Labels sitting on an orange fill are `{colors.text.primary}`, not white: 5.74:1 on
`{colors.brand.primary}` and 4.78:1 on `{colors.brand.pressed}` — the same label color is legal in
both states, so pressing a button never flickers its text color. White on `#FF5A1F` would be
3.12:1 and is forbidden.

### Surface

| Name | Token | Hex | Role |
|------|-------|-----|------|
| Rail | `{colors.ink.base}` | `#0E0E10` | Sidebar background. |
| Rail Raised | `{colors.ink.raised}` | `#1A1A1D` | Active nav item, API status card. |
| Rail Hairline | `{colors.ink.hairline}` | `#2A2A2F` | Dividers inside the rail. |
| Canvas | `{colors.surface.canvas}` | `#FFFFFF` | Topbar, chat body, player bar, cards, dialogs. |
| Muted | `{colors.surface.muted}` | `#F7F7F5` | Settings panel, neutral bubbles, dialog footer, disabled player card. |
| Hairline | `{colors.surface.hairline}` | `#E4E4E1` | Every 1px border in the light region. |
| Hairline Strong | `{colors.surface.hairline-strong}` | `#CFCFCB` | Dashed dropzone border, resting waveform bars. |
| Disabled Fill | `{colors.surface.disabled}` | `#EDEDEA` | Disabled button fill. |

### Text

| Name | Token | Hex | Role |
|------|-------|-----|------|
| Primary | `{colors.text.primary}` | `#17171A` | Headings, body, labels on orange fills. 17.89:1 on canvas. |
| Secondary | `{colors.text.secondary}` | `#6B6B72` | Every caption, metadata line and helper text. 5.29:1 on canvas, 4.93:1 on muted. |
| Disabled | `{colors.text.disabled}` | `#9A9AA3` | **Disabled controls only** (2.79:1 on canvas — WCAG exempts disabled controls). Never used for live captions. |
| Inverse | `{colors.text.inverse}` | `#FFFFFF` | Text on `{colors.semantic.danger}` fill; glyphs on dark shapes. |
| Rail Text | `{colors.ink.text}` | `#F2F2F3` | Active/primary text in the rail. 17.24:1 on `{colors.ink.base}`. |
| Rail Muted | `{colors.ink.text-muted}` | `#9A9AA3` | Inactive nav labels, section overlines, host line. 6.91:1 on rail — the same grey that is illegal on white is legal here, which is why it is two tokens. |

### Semantic

The product has four genuinely distinct machine states, so the semantic palette is real and each
entry maps to one `SummaryStatus` value.

| Name | Token | Hex | Soft | Maps to |
|------|-------|-----|------|---------|
| Success | `{colors.semantic.success}` | `#177247` | `{colors.semantic.success-soft}` `#E4F6EC` | `Completed`, `201 Created` |
| Danger | `{colors.semantic.danger}` | `#C4271C` | `{colors.semantic.danger-soft}` `#FDECEA` | `Failed`, destructive confirm |
| Info | `{colors.semantic.info}` | `#3F4EA8` | `{colors.semantic.info-soft}` `#ECEEFB` | `Processing` |
| Warning | `{colors.semantic.warning}` | `#8A5A02` | `{colors.semantic.warning-soft}` `#FDF3E0` | Reversible-but-lossy confirm ("Recomeçar") |

One extra edge token exists because `{colors.surface.hairline}` disappears against a red tint:
`{colors.semantic.danger-border}` = `#F6D2CE`, used only as the 1px border of surfaces filled with
`{colors.semantic.danger-soft}`.

Measured: success 5.29:1 on its soft tint, danger 5.03:1, info 6.35:1, warning 5.38:1;
`{colors.text.inverse}` on `{colors.semantic.danger}` is 5.75:1.
`Pending` deliberately has **no** semantic color — it renders in `{colors.text.secondary}` on
`{colors.surface.muted}`, because "queued" is not an outcome. It also has **no chip of its own**:
in the topbar, `Pending` and `Processing` both show `{component.status-chip-processing}`
("Processando"), because from the user's side both mean "the server is working on it". The
distinction is preserved where it is actionable — inside the thread, which prints the literal API
word (`Pending`, `Processing`) in `{type.mono}`.

### Focus

| Name | Token | Hex | Role |
|------|-------|-----|------|
| Focus Light | `{colors.focus.ring-light}` | `#B23A0E` | 2px focus ring on light surfaces. 5.99:1 on canvas. |
| Focus Dark | `{colors.focus.ring-dark}` | `#FF8C5A` | 2px focus ring inside the rail. 8.4:1 on `{colors.ink.base}`. |

The ring is a pair for the same reason the orange is: one value per surface family, each legal
exactly where the other fails. A focus indicator is a graphical object under SC 1.4.11 — both
values clear 3:1 with room to spare.

---

## 3. Typography

### Font Family

- **Inter** — the entire interface. Weights used: Regular (400), Medium (500), Semi Bold (600).
  Stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **JetBrains Mono** — data only: audio ids, byte counts, durations, percentages, character counts,
  API status enums, endpoint paths. Weights used: Regular (400), Medium (500).
  Stack: `"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`.

**Note on Font Substitutes** — both faces are open source (Inter: SIL OFL; JetBrains Mono: Apache
2.0) and self-hostable, so no substitution is required. If a build must drop a webfont, Inter falls
back to the system UI stack above and JetBrains Mono to `SFMono-Regular`/`Consolas`; the type scale
is unchanged, only the metrics shift slightly.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|-------|------|--------|-------------|----------------|-----|
| `{type.display}` | 28px | Semi Bold | 34px | 0 | Foundations sheet title only |
| `{type.title}` | 19px | Semi Bold | 28px | 0 | Dialog titles — "Transcrição concluída", "Falha na transcrição" |
| `{type.heading}` | 16px | Semi Bold | 24px | 0 | Topbar title "Transcrição de áudio"; empty-state headline (18px optical exception is not permitted — use this token) |
| `{type.body-lg}` | 14px | Regular | 23px | 0 | The summary text itself; primary button labels (Semi Bold) |
| `{type.body}` | 13px | Regular | 20px | 0 | Message lines — "Na fila para transcrição"; select values; dialog body copy |
| `{type.label}` | 12px | Medium | 18px | 0 | Buttons, chips, message author "Sistema", file names in cards |
| `{type.caption}` | 11px | Regular | 17px | 0 | "3,4 MB · WAV · 2:40", helper lines under the CTA |
| `{type.overline}` | 11px | Semi Bold | 17px | +0.6px | Panel field labels "ÁUDIO", "IDIOMA", "RESUMO", "ESTADO"; rail sections "CONTEXTO" |
| `{type.mono}` | 11px | Regular | 17px | 0 | `id 4c34be9c-…`, `summaryStatus: "Failed"`, `201 / 500 caracteres`, `Pending`, `1x`, `0:04` |

### Principles

Size carries hierarchy; weight carries emphasis; color carries state. A line never uses all three
at once. The summary — the one thing the user came for — is the only 14px body block in the app,
and it is the only text allowed to exceed two lines. Everything else is a label, a value or a
status, and all three are short by construction.

Mono is not decoration: if a string comes from the API verbatim (an id, an enum, a byte count, a
path), it is mono. If it is written by the interface for a human, it is Inter. That rule makes it
possible to tell, without reading, whether a value can be trusted as a literal.

Overline labels are the only tracked type in the system. They exist to separate panel fields
without drawing a divider for each one.

---

## 4. Layout

### Spacing System

Base unit **4px**. Every gap, pad and offset is a multiple of it.

| Token | Value | Use |
|-------|-------|-----|
| `{spacing.1}` | 4px | Icon-to-label inside a chip's inner cluster; badge vertical padding |
| `{spacing.2}` | 8px | Bubble internal stack gap; chip gap; button icon gap |
| `{spacing.3}` | 12px | Card padding-y; panel field internal gap; button group gap |
| `{spacing.4}` | 16px | Card padding-x; dialog body row gap; bubble padding-y |
| `{spacing.5}` | 20px | Panel padding; panel field-to-field gap |
| `{spacing.6}` | 24px | Dialog padding-x; message-to-message gap in the thread (18px is not permitted — use this token) |
| `{spacing.8}` | 32px | Chat body padding-y |
| `{spacing.12}` | 48px | Foundations sheet padding; page-level breathing room |

Dominant rhythm inside the thread: **24px between message rows, 8px between a message header and
its bubble.** That two-step rhythm is what makes the conversation scannable when six rows are
stacked.

### Grid & Container

The app is a **three-column shell at a fixed 1440×900 design frame**, not a centered document:

| Region | Width | Behavior |
|--------|-------|----------|
| `{layout.rail}` | 240px | Fixed. Never scrolls with content. |
| `{layout.center}` | fluid (880px at 1440) | Fills remaining space. Contains topbar (64px), chat body (fluid, scrolls), player bar (84px). |
| `{layout.panel}` | 320px | Fixed. Controls only. |

- **Message max width**: `{layout.bubble}` = 624px. Bubbles do not stretch to the full center
  column — a 900px-wide line of summary text is unreadable, and the fixed measure keeps the thread
  looking like a thread at any viewport.
- **Dialog widths**: 540px (upload), 520px (outcome dialogs), 480px (confirm). All centered on both
  axes of the viewport.
- **Empty state alignment is explicit**: the empty chat body centers its content on **both** axes
  of `{layout.center}` — headline, subline and icon share the column's center line. It is never
  left-aligned in a wide container.

### Component Metrics

A handful of component-intrinsic sizes do not fall on the 4px scale, because they are optical
(a circle that must center a glyph) rather than rhythmic. They are tokens too — implementations
must reference these names, never re-derive the number.

| Token | Value | Use |
|-------|-------|-----|
| `{size.glyph-circle}` | 22px | Message row identity circle |
| `{size.glyph-circle-sm}` | 16px | Inline glyph inside a loading row or a stepper step |
| `{size.glyph-circle-lg}` | 56px | Empty-state and dialog outcome circle (40px at `{bp.mobile}`) |
| `{size.file-tile}` | 34px | `{component.file-card}` icon tile |
| `{size.play-button}` | 38px | `{component.button-play}` (44px at `{bp.tablet}` and below) |
| `{size.accent-rail}` | 3px | Left accent rail on bubbles and the active nav item |
| `{size.wave-bar}` | 3px wide, 6–24px tall | `{component.waveform}` bars |
| `{size.measure-narrow}` | 360px | Max line length of centered empty-state copy |

### Whitespace Philosophy

The panel and the rail are dense; the canvas is not. That contrast is intentional: controls should
read as a compact instrument cluster, while the thread should read as content with room to breathe.
The chat body keeps 32px of vertical padding and 40px horizontal even when a single message is
present, so the first message never looks pinned to the chrome.

Empty space in the thread is a feature, not a gap to fill. After a `Completed` summary the thread
does not backfill with suggestions, related files, or export options — the screen's job is done and
it shows that by staying empty below the last message.

---

## 5. Elevation & Depth

| Level | Treatment | Use |
|-------|-----------|-----|
| `{elevation.0}` | Flat fill, no border | Rail, canvas, panel backgrounds |
| `{elevation.1}` | 1px `{colors.surface.hairline}` border, no shadow | Cards, bubbles, selects, file cards, chips, player card, stepper |
| `{elevation.2}` | `0 18px 44px -6px rgba(0,0,0,0.22)` | **Modal dialogs only** |
| `{elevation.scrim}` | `{colors.ink.base}` at 42% opacity, full viewport | Behind any dialog |

Separation in this system comes from surface change and hairlines, not from shadow. A card on
`{colors.surface.muted}` is `{colors.surface.canvas}` plus a hairline; a card on canvas is
`{colors.surface.muted}` plus a hairline. Two adjacent surfaces always differ by a fill *and* an
edge — a fill change alone is not enough separation at these low-contrast greys.

The single shadow exists because the modal must read as detached from a busy screen; the scrim
alone would not lift it off the white canvas.

### Decorative Depth

There is none. No illustrations, no mascot, no gradient, no glass, no noise texture. The only
non-rectangular ornaments in the product are the **waveform** (72 rounded bars, played portion in
`{colors.brand.primary}`, remainder in `{colors.surface.hairline-strong}`) and the **glyph circles**
that head each message and each panel field. Both are functional: one shows position in the audio,
the other shows who is speaking in the thread.

---

## 6. Shapes

### Border Radius Scale

| Token | Value | Use |
|-------|-------|-----|
| `{rounded.sm}` | 8px | Selects, small cards, nav items, code blocks, stepper container, file-card icon tile |
| `{rounded.md}` | 12px | Message bubbles, dropzone, player card, summary preview card |
| `{rounded.lg}` | 16px | Modal dialog only |
| `{rounded.full}` | 999px | Buttons, chips, badges, avatars, glyph circles, progress bars, waveform bars |

Four radii, and the rule that assigns them is size-based: the bigger the surface, the softer the
corner, with everything interactive-and-small collapsing to a pill. There is no 4px and no 20px in
the system; if a component seems to need one, it is the wrong size.

### Iconography

The system has **no icon set**. Every glyph is a text character rendered in the UI font
(`♪ ↑ ✓ ◐ ○ ✕ ⚠ ▾ ↻`), always `aria-hidden` with the meaning carried by adjacent text. This is a
deliberate scarcity decision: an icon library would be a dependency, a second visual language and
a licensing surface, for roughly nine marks. If a glyph ever fails to render across the supported
platforms, replace that single mark with an inline SVG path — not the whole set with a library.

### Photography Geometry

The product displays no photography and no user avatars. Message identity is a 22px
`{rounded.full}` glyph circle: `{colors.surface.muted}` for "Você" and "Sistema",
`{colors.brand.soft}` for "Resumo", `{colors.semantic.danger-soft}` for a failure row. If avatars
are ever introduced they inherit the same 22px circle — the thread's left gutter is 30px and cannot
absorb a larger shape.

---

## 7. Components

**Hover-state policy**: the system documents exactly one hover treatment — interactive surfaces
darken by one step (`{colors.surface.canvas}` → `{colors.surface.muted}` on light,
`{colors.ink.base}` → `{colors.ink.raised}` in the rail) with no movement, no shadow change and no
color-hue change. Filled orange controls hover to `{colors.brand.pressed}`. No other hover states
exist; do not invent them.

### Buttons

**`{component.button-primary}`** — background `{colors.brand.primary}`, label `{type.body-lg}`
Semi Bold in `{colors.text.primary}`, padding `{spacing.3}` / `{spacing.5}`, radius
`{rounded.full}`, no border, no shadow. Full-width when it is the panel CTA
("Enviar outro áudio"), hug-width in a dialog footer ("Enviar e transcrever").

**`{component.button-primary-pressed}`** — as above, background `{colors.brand.pressed}`. Label
color is unchanged.

**`{component.button-primary-disabled}`** — background `{colors.surface.disabled}`, label
`{colors.text.disabled}`, cursor `not-allowed`. Used for "Transcrever" until a file is selected.

**`{component.button-primary-loading}`** — background `{colors.brand.primary}`, label prefixed by a
16px rotating glyph, text "Enviando…" / "Transcrevendo…", control is `aria-busy` and
non-interactive. When the loading state is *waiting on the server* rather than *sending bytes*
(i.e. `Processing`), the fill drops to `{colors.surface.disabled}` with `{colors.text.disabled}`
label — the button is no longer the thing making progress, the thread is.

**`{component.button-ghost}`** — background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}` border, label `{type.label}` in `{colors.text.primary}`, padding
`{spacing.2}` / `{spacing.4}`, radius `{rounded.full}`. Used for "Recomeçar" (topbar),
"Cancelar", "Fechar".

**`{component.button-danger}`** — background `{colors.semantic.danger}`, label `{type.body-lg}`
Semi Bold in `{colors.text.inverse}`, radius `{rounded.full}`. Exactly one use: "Recomeçar" inside
`{component.dialog-confirm}`.

**`{component.button-play}`** — 38px `{rounded.full}` circle, `{colors.brand.primary}` fill, white
triangle glyph. Disabled variant `{component.button-play-disabled}`: fill
`{colors.surface.hairline-strong}`, whole player card at 55% opacity.

### Inputs & Forms

**`{component.dropzone}`** — vertical stack, background `{colors.surface.canvas}`, 1px dashed
`{colors.surface.hairline-strong}` border (dash 6 / gap 4), radius `{rounded.md}`, padding
`{spacing.5}`, gap `{spacing.2}`, centered. Contains: 36px `{colors.brand.soft}` glyph circle with
an upload arrow in `{colors.brand.text}`; `{type.body}` Semi Bold headline "Arraste um áudio aqui";
`{type.caption}` in `{colors.text.secondary}` listing the accepted extensions and the 50 MB ceiling
(both taken from `Upload:AllowedExtensions` and `Upload:MaxSizeBytes`);
`{component.button-secondary}` "Escolher arquivo".

**`{component.dropzone-dragover}`** — background `{colors.brand.soft}`, 2px dashed
`{colors.brand.primary}` border, headline swaps to "Solte o arquivo para enviar" in
`{colors.brand.text}`. This is the only state where the dashed border is 2px.

**`{component.button-secondary}`** — background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}` border, `{type.label}` in `{colors.text.primary}`, radius
`{rounded.full}`, padding `{spacing.1}`/`{spacing.4}`.

**`{component.file-card}`** — horizontal row, background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}`, radius `{rounded.sm}`, padding `{spacing.3}`, gap `{spacing.3}`.
Contains a 34px `{rounded.sm}` `{colors.brand.soft}` tile with a note glyph in
`{colors.brand.text}`; a two-line stack of file name (`{type.label}` Semi Bold,
`{colors.text.primary}`) and `{type.caption}` metadata in `{colors.text.secondary}`; a flexible
spacer; a dismiss "✕" in `{colors.text.secondary}`. The name column must carry `min-width: 0` and
truncate with an ellipsis — it must never push the dismiss control out of the card.
The metadata line shows only what has been measured: size and format always, duration **only**
where the audio element has reported it (the player). A card outside the player reads
"3,4 MB · WAV", never a guessed "2:40".

**`{component.select}`** — height 40px, background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}`, radius `{rounded.sm}`, padding `{spacing.3}`, value in `{type.body}`
`{colors.text.primary}`, chevron in `{colors.text.secondary}`. One instance: "Idioma → Detectar
automaticamente".

**`{component.field-group}`** — vertical stack, gap `{spacing.2}`, first child is a
`{type.overline}` label in `{colors.text.secondary}`. Every panel control is wrapped in one.

**`{component.text-input-focused}`** / **`{component.select-focused}`** — 2px
`{colors.focus.ring-light}` ring offset 2px outside the control's border; the resting border is
unchanged. Inside the rail, the ring is `{colors.focus.ring-dark}`.

### Thread

**`{component.message-row}`** — vertical stack, gap `{spacing.2}`, width hug up to
`{layout.bubble}`. Header: 22px `{rounded.full}` glyph circle + author in `{type.label}` Semi Bold
`{colors.text.primary}` + timestamp in `{type.caption}` `{colors.text.secondary}`.

**`{component.bubble}`** — background `{colors.surface.muted}`, 1px `{colors.surface.hairline}`,
radius `{rounded.md}`, padding `{spacing.3}` `{spacing.4}`, internal gap `{spacing.2}`, width
`{layout.bubble}` fixed. Neutral state lines ("Na fila para transcrição") plus a right-aligned
`{type.mono}` status word in `{colors.text.secondary}`.

**`{component.bubble-upload}`** — as `{component.bubble}` but background
`{colors.surface.canvas}`; hosts a `{component.file-card}` row and, once stored, the
`{type.mono}` id line and a `201 Created` `{component.badge-success}`.

**`{component.bubble-loading}`** — as `{component.bubble}` plus a 3px left accent rail in
`{colors.brand.primary}` (upload) or `{colors.semantic.info}` (transcription). Contains: a 16px
soft-tinted glyph circle, a `{type.body}` Medium action line, a right-aligned `{type.mono}`
percentage or status word, a `{component.progress-bar}`, and a `{type.caption}` explanation in
`{colors.text.secondary}`. **This is the component the loading test asserts on.**

**`{component.bubble-summary}`** — background `{colors.surface.canvas}`, 3px left accent rail in
`{colors.brand.primary}`, radius `{rounded.md}`. Body is the summary in `{type.body-lg}`
`{colors.text.primary}`. Footer row: `{component.badge-mono}` with the detected language, then
`{type.mono}` `"201 / 500 caracteres"` in `{colors.text.secondary}`, then a right-aligned
`{type.caption}` provenance line "Whisper tiny · resumo extrativo".

**`{component.bubble-error}`** — background `{colors.semantic.danger-soft}`, 1px `{colors.semantic.danger-border}` border,
3px left accent rail in `{colors.semantic.danger}`. Title `{type.body-lg}` Semi Bold in
`{colors.semantic.danger}`; explanation `{type.body}` in `{colors.text.primary}`; a
`{component.code-line}`; then an action row of `{component.button-primary}` "Tentar novamente" +
`{component.button-ghost}` "Enviar outro áudio" at `{spacing.2}` gap.

**`{component.code-line}`** — background `{colors.surface.canvas}`, 1px border inheriting the
parent bubble's border color, radius `{rounded.sm}`, padding `{spacing.2}` `{spacing.3}`,
`{type.mono}` in `{colors.text.secondary}`. Renders raw API values only.

**`{component.progress-bar}`** — 6px track, radius `{rounded.full}`, track
`{colors.surface.hairline}`, fill `{colors.brand.primary}` (upload) or `{colors.semantic.info}`
(transcription), width driven by percentage. Determinate for upload (real bytes); for
`Processing`, where the server reports no percentage, the same bar runs an indeterminate 30%-width
sweep and the numeric label is replaced by the literal status word `Processing`. Never fabricate a
percentage for work the API does not measure.

**`{component.empty-state}`** — centered on both axes: 56px `{colors.brand.soft}` circle with a
note glyph in `{colors.brand.text}`, `{type.heading}` headline "Nenhum áudio ainda",
`{type.body}` subline in `{colors.text.secondary}` capped at 360px and centered.

### Status & Badges

**`{component.status-chip}`** — pill, radius `{rounded.full}`, padding `{spacing.1}`
`{spacing.3}`, 6px dot + `{type.label}` Medium. Five variants, one per real state:

| Variant | Dot / label color | Background | Copy |
|---------|------------------|------------|------|
| `{component.status-chip-idle}` | `{colors.text.secondary}` | `{colors.surface.muted}` | "Aguardando arquivo" |
| `{component.status-chip-uploading}` | `{colors.brand.text}` | `{colors.brand.soft}` | "Enviando…" |
| `{component.status-chip-processing}` | `{colors.semantic.info}` | `{colors.semantic.info-soft}` | "Processando" |
| `{component.status-chip-completed}` | `{colors.semantic.success}` | `{colors.semantic.success-soft}` | "Concluído" |
| `{component.status-chip-failed}` | `{colors.semantic.danger}` | `{colors.semantic.danger-soft}` | "Falhou" |
| `{component.status-chip-disabled}` | `{colors.text.secondary}` | `{colors.surface.muted}` | "Resumo desativado" |

`Disabled` (the API's `Summarization:Enabled = false`) is **not a failure**: the upload succeeded
and the file is stored, the server simply does not summarize. It therefore reuses the neutral
treatment — `{component.status-chip-disabled}` in the topbar and a plain `{component.bubble}` in
the thread reading "Resumo desativado no servidor. O áudio foi armazenado." Red is reserved for
`Failed`. The stepper, in this phase, shows "Enviado" done and the remaining steps
`{component.stepper-step-pending}`, with no active step.

**`{component.badge-mono}`** — pill, `{colors.surface.muted}` (or `{colors.brand.soft}` for the
"máx. 500" rule badge), `{type.mono}` Medium, padding `{spacing.1}`/`{spacing.2}`.

**`{component.badge-success}`** — pill, `{colors.semantic.success-soft}` background,
`{colors.semantic.success}` `{type.mono}` Medium label. One use: `201 Created`.

**`{component.stepper}`** — container `{colors.surface.canvas}`, 1px `{colors.surface.hairline}`,
radius `{rounded.sm}`, padding `{spacing.3}`, row gap `{spacing.2}`. Each row is a 16px glyph
circle + `{type.label}`:

| Variant | Glyph / circle | Label |
|---------|----------------|-------|
| `{component.stepper-step-done}` | ✓ `{colors.semantic.success}` on `{colors.semantic.success-soft}` | `{colors.text.secondary}` Regular |
| `{component.stepper-step-active}` | ◐ `{colors.semantic.info}` on `{colors.semantic.info-soft}` | `{colors.text.primary}` Medium |
| `{component.stepper-step-pending}` | ○ `{colors.text.secondary}` on `{colors.surface.muted}` | `{colors.text.secondary}` Regular |
| `{component.stepper-step-failed}` | ✕ `{colors.semantic.danger}` on `{colors.semantic.danger-soft}` | `{colors.semantic.danger}` Medium |

Step labels quote the API vocabulary verbatim: "Enviado", "Na fila (Pending)", "Transcrevendo
(Processing)", "Concluído (Completed)".

### Navigation

**`{component.sidebar}`** — 240px, `{colors.ink.base}`, padding `{spacing.4}` `{spacing.3}`, item
gap `{spacing.1}`.

**The rail has exactly one destination.** One `{component.nav-label}` ("ÁUDIO") and one
`{component.nav-item-active}` ("Transcrever"). No "Biblioteca", no "CONTEXTO" group, no
"Arquivos", no "Chaves de API" — a nav entry that leads nowhere is a promise the product does not
keep, and this product is one screen. The rail still exists because it carries identity and the
API status card, not because it navigates. Adding a second entry requires a second real screen
first.

**`{component.brand-lockup}`** — 30px `{rounded.sm}` `{colors.brand.primary}` tile with "P" in
`{colors.text.primary}` Bold, plus a two-line stack: "Prog7" `{type.label}` Semi Bold
`{colors.ink.text}` over "Audio Studio" `{type.caption}` `{colors.ink.text-muted}`.

**`{component.nav-item}`** — 3px transparent left bar + glyph + `{type.body}` label in
`{colors.ink.text-muted}`, radius `{rounded.sm}`, padding `{spacing.2}`.

**`{component.nav-item-active}`** — background `{colors.ink.raised}`, 3px left bar in
`{colors.brand.primary}`, glyph in `{colors.brand.primary}`, label `{colors.ink.text}` Medium.

**`{component.nav-label}`** — `{type.overline}` in `{colors.ink.text-muted}`, padding-top
`{spacing.4}`, padding-bottom `{spacing.2}`. The generous top padding exists so the label never
collides with the filled background of an active item directly below it. The system currently
renders exactly one of these ("ÁUDIO").

**`{component.api-status-card}`** — pinned to the bottom of the rail: `{colors.ink.raised}`,
radius `{rounded.sm}`, 8px `{colors.semantic.success}` dot, "API online" `{type.label}` in
`{colors.ink.text}`, host in `{type.mono}` `{colors.ink.text-muted}`.

**`{component.topbar}`** — 64px, `{colors.surface.canvas}`, 1px bottom `{colors.surface.hairline}`,
padding-x `{spacing.6}`. Left: `{type.heading}` title. Right: the current
`{component.status-chip}` then `{component.button-ghost}` "Recomeçar".

### Panel & Player

**`{component.settings-panel}`** — 320px, `{colors.surface.muted}`, 1px left
`{colors.surface.hairline}`, padding `{spacing.5}`, field gap `{spacing.5}`. Order is fixed: header
→ Áudio → Idioma → Resumo → Estado (only once an upload exists) → flexible spacer → CTA → helper
line in `{type.caption}` `{colors.text.secondary}`, centered.

**`{component.player-bar}`** — 84px, `{colors.surface.canvas}`, 1px top
`{colors.surface.hairline}`, padding-x `{spacing.6}`. Hosts one `{component.player-card}`.

**`{component.player-card}`** — background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}`, radius `{rounded.md}`, padding `{spacing.3}`, gap `{spacing.4}`:
`{component.button-play}`, elapsed `{type.mono}`, `{component.waveform}`, duration `{type.mono}`,
`{component.chip-speed}`.

**`{component.player-card-disabled}`** — background `{colors.surface.muted}`, whole card at 55%
opacity, `{component.button-play-disabled}`, both times read `0:00`. Used until the file is stored.

**`{component.waveform}`** — 72 bars, 3px wide, radius `{rounded.full}`, heights 6–24px,
`{spacing.1}` gap; played bars `{colors.brand.primary}`, unplayed
`{colors.surface.hairline-strong}`. The bar set is decorative-but-proportional: it must be derived
from the file's own peaks when available, never re-randomized between renders of the same file.

**`{component.chip-speed}`** — pill, `{colors.surface.canvas}`, 1px `{colors.surface.hairline}`,
`{type.mono}` in `{colors.text.secondary}`. Values `1x`, `1.5x`, `2x`.

### Overlays

**`{component.scrim}`** — full viewport, `{colors.ink.base}` at 42%. Click dismisses any dialog
except `{component.dialog-confirm}`.

**`{component.dialog}`** — `{colors.surface.canvas}`, radius `{rounded.lg}`, `{elevation.2}`,
centered on both axes, width per §4.

**`{component.dialog-header}`** — padding `{spacing.6}` top / `{spacing.6}` sides, title
`{type.title}`, optional subline `{type.body}` in `{colors.text.secondary}`, dismiss "✕" in
`{colors.text.secondary}` on the right.

**`{component.dialog-body-centered}`** — used by outcome dialogs: `{size.glyph-circle-lg}`
soft-tinted glyph circle (`{colors.semantic.success-soft}` + ✓, or
`{colors.semantic.danger-soft}` + ⚠), `{type.body}` subline in `{colors.text.secondary}`, then one
detail card — either `{component.summary-preview-card}` or `{component.error-detail-card}`.
The dialog's headline belongs to `{component.dialog-header}` and is rendered **once**: the body
does not repeat it.

**`{component.summary-preview-card}`** — `{colors.surface.muted}`, 1px
`{colors.surface.hairline}`, radius `{rounded.md}`, quoted summary in `{type.body}`, footer row of
`{component.badge-mono}` language + `{type.mono}` character count + right-aligned elapsed time.

**`{component.error-detail-card}`** — `{colors.semantic.danger-soft}`, 1px `{colors.semantic.danger-border}`, radius
`{rounded.md}`, title `{type.body}` Semi Bold in `{colors.semantic.danger}` with the raw
`{type.mono}` status on the right, explanation `{type.caption}` in `{colors.text.secondary}`.

**`{component.dialog-footer}`** — `{colors.surface.muted}`, 1px top `{colors.surface.hairline}`,
padding `{spacing.6}` sides / `{spacing.4}` top / `{spacing.5}` bottom. Optional left-aligned
`{type.caption}` note in `{colors.text.secondary}`, buttons right-aligned at `{spacing.2}` gap,
primary always last.

**`{component.dialog-confirm}`** — 480px, no centered glyph column: the `{type.title}` question
lives in `{component.dialog-header}` (which takes no leading glyph), and a 40px
`{colors.semantic.warning-soft}` circle sits in the body beside the `{type.body}`
consequence copy in `{colors.text.secondary}`; footer with `{component.button-ghost}` "Cancelar" +
`{component.button-danger}`. The consequence copy must state what is *not* destroyed ("O arquivo e
o resumo já salvos no servidor não são apagados"), because the action is local-only. It must not
point the user at a screen that does not exist — no "continuam acessíveis em Biblioteca".

---

## 8. Do's and Don'ts

**Do**

1. Use `{colors.brand.text}` for every orange string or glyph; `{colors.brand.primary}` only for
   fills, bars and shapes.
2. Label every `{component.button-primary}` with `{colors.text.primary}` — the same value in
   resting and pressed, so the label never flickers on press.
3. Quote the API's own vocabulary in status UI: `Pending`, `Processing`, `Completed`, `Failed`,
   `201 Created`, rendered in `{type.mono}`.
4. Wrap every panel control in a `{component.field-group}` with a `{type.overline}` label.
5. Render one `{component.message-row}` per real backend transition — the thread is the state log.
6. Cap the thread at `{layout.bubble}` (624px) regardless of viewport width.
7. Show the summary's length against its ceiling (`201 / 500 caracteres`) — the ceiling is a domain
   invariant, so it is visible, not implied.
8. Give any flexible text column `min-width: 0` and ellipsis truncation before a neighbouring
   control can be pushed out of view.

**Don't**

1. Don't put white text on `{colors.brand.primary}` (3.12:1). Filled orange controls take ink
   labels.
2. Don't use `{colors.text.disabled}` for live captions — it is 2.79:1 on canvas and exists for
   disabled controls only. Captions are `{colors.text.secondary}`.
3. Don't invent a percentage for `Processing`. Unmeasured work gets the indeterminate
   `{component.progress-bar}` and the literal status word.
4. Don't fake per-segment timestamps or speaker names. The API returns one ≤500-character summary;
   the thread shows exactly that.
5. Don't add a shadow to anything but `{component.dialog}` — separation is hairline plus surface
   change.
6. Don't introduce a second accent hue. State color comes from the four semantic tokens; brand
   color means "the app is working on this".
7. Don't add download, export or share affordances — the product transcribes and displays, nothing
   else. The player is playback-only.
8. Don't let a toast replace a message row. Transient notifications lose the history that makes the
   wait legible.
9. Don't use a radius outside the four defined values, and never round a modal at
   `{rounded.md}` or a chip at anything but `{rounded.full}`.

---

## 9. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| `{bp.desktop}` | ≥ 1280px | Full three-column shell as designed. |
| `{bp.laptop}` | 1024–1279px | `{layout.panel}` collapses to a right drawer opened by a "Configurações" `{component.button-ghost}` in the topbar; center column takes the freed width; `{layout.bubble}` unchanged. |
| `{bp.tablet}` | 768–1023px | `{component.sidebar}` becomes a 64px icon rail (glyphs only, labels as tooltips); the drawer from `{bp.laptop}` persists. |
| `{bp.mobile}` | < 768px | Single column. Rail becomes brand + hamburger in the topbar, with all nav destinations and the API status inside the menu. Settings become a bottom sheet opened by a full-width "Configurações" trigger under the topbar. Player bar docks to the bottom edge. |

### Touch Targets

Every interactive element is ≥ 44×44px at `{bp.tablet}` and below: `{component.button-play}` grows
from 38px to 44px; `{component.nav-item}` and `{component.select}` grow to 44px height; the
`{component.file-card}` dismiss "✕" gets a 44px hit area while keeping its 12px glyph. Chips and
badges are non-interactive and exempt. Contrast target is **WCAG AA** throughout: 4.5:1 for text,
3:1 for graphical objects and focus indicators — every pair rendered by the system is listed with
its measured ratio in §2.

### Collapsing Strategy

- **Nav**: never compress desktop nav into a cramped row. Below `{bp.tablet}` it is brand +
  hamburger; authentication-free as this app is, the menu still carries every destination and the
  API status card.
- **Settings panel**: becomes a disclosure (drawer, then bottom sheet), collapsed by default, with
  `aria-expanded` / `aria-controls` and a summary of the current selection ("cosmic-audio.wav ·
  pt") visible on the trigger while collapsed.
- **Thread**: bubbles go full-width minus `{spacing.4}` gutters below `{bp.mobile}`; the message
  header stays a single row (glyph + author + timestamp) and the timestamp truncates first.
- **Player**: at `{bp.mobile}` the `{component.waveform}` is hidden and the card keeps play +
  elapsed/duration + speed only. It never wraps to two rows.
- **Dialogs**: at `{bp.mobile}` they become full-width sheets with `height: 100dvh`, compact
  padding (`{spacing.4}`), and the decorative 56px glyph circle drops to 40px before any content
  is allowed to scroll. Footer buttons stack full-width, primary on top.
- **Spacing**: `{spacing.8}` body padding steps down to `{spacing.4}` at `{bp.mobile}`;
  `{spacing.6}` message rhythm steps down to `{spacing.5}`.

### Image Behavior

There are no raster images in the product. The waveform is vector and scales by re-computing bar
count to fill the available width (bar width and gap are fixed; count varies). Glyph circles never
scale below 20px.

---

## 10. Iteration Guide

1. **Change one component per iteration.** Edit its entry here first, then the Figma frame, then
   the code. The order matters — this document is what the code agents read.
2. **Reference tokens directly.** A new property must be written as `{colors.…}` / `{spacing.…}` /
   `{rounded.…}` / `{type.…}`. If the value you need has no token, add the token in §2–§6 with a
   stated role before using it, and justify why the existing scale could not express it.
3. **Variants are separate entries.** `-active`, `-disabled`, `-focused`, `-loading`, `-pressed`
   each get their own block with their own full property list. Never write "same as above but
   darker".
4. **Every new color pair must be measured.** State the contrast ratio in the entry. If a value is
   legal only under a condition the token layer cannot express (large text only, one background
   only), change the value instead of documenting the condition.
5. **Lint before shipping**: `npx @google/design.md lint DESIGN.md` — it checks broken token
   references, contrast ratios, and orphaned tokens. Orphaned tokens are a signal to delete, not to
   find a use for.
6. **Respect the scarcity rules**: one accent hue (split into a graphic value and a text value),
   four radii, one shadow, two type families, nine type tokens, four semantic colors. Adding to any
   of these lists requires deleting from it or justifying the addition in this section.
7. **Do not resolve a design gap inline in code.** If implementation hits an undocumented state,
   the fix is a new `/darkdesign` pass on this document, then the code.

---

## 11. Known Gaps

- **No dark theme for the working surface.** The rail is dark by construction, but the canvas and
  panel have no dark variant. The token structure would support one (invert the surface/text
  scales, keep both oranges), but no dark values are defined or measured.
- **Only the desktop frame is drawn.** All four breakpoints in §9 are specified in prose; only
  `{bp.desktop}` (1440×900) exists as a Figma frame. Mobile layouts are unverified in pixels.
- **Hover, focus and pressed states are specified but not drawn.** §7 states the policy and the
  ring tokens; no Figma frame shows them. The same applies to keyboard focus order.
- **Motion is undocumented.** Progress bar animation, the indeterminate sweep, the spinner glyph
  rotation, dialog enter/exit and thread auto-scroll have no durations, easings or
  `prefers-reduced-motion` fallbacks defined here. **Consequence in the shipped implementation:**
  the indeterminate `{component.progress-bar}` renders its 30%-width element **statically** — it
  communicates "unmeasured", not "moving" — because inventing a duration would be an inline visual
  decision. The one animated element is the loading button glyph, which §7 explicitly calls
  "rotating". Closing this gap is a `/darkdesign` pass, not a code tweak.
- **Reference harvest limits.** The Mistral "Speech to text" and Hume screens were harvested from
  static screenshots only — no hover states, no mobile views, no authenticated chrome and no
  computed CSS were available. The palette, layout split and pill/hairline language are derived
  from those images; the exact hexes are this system's own, chosen to satisfy the contrast
  measurements in §2 rather than sampled pixel-for-pixel.
- **Screens not designed**: none are promised. The rail used to advertise "Biblioteca",
  "Arquivos" and "Chaves de API"; those entries were removed on the owner's instruction because
  nav that leads nowhere is a broken promise. Error surfaces for rejected files (wrong extension,
  > 50 MB, 422 "not decodable as audio") are named in copy but still have no dedicated dialog —
  they surface through `{component.bubble-error}`.
- **Multi-file / multi-session behavior is undefined.** The thread models exactly one audio at a
  time; queueing several uploads, or returning to a previous audio's summary, has no design.
- **The waveform has no real data source.** The API exposes no peak data, so the drawn bars are
  proportional decoration. §7 forbids re-randomizing them, but the derivation from actual audio
  peaks is not specified.
