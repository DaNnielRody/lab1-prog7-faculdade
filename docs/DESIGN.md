# Prog7 — Audio Summary Studio · DESIGN.md

> Single source of truth for the frontend of the Prog7 audio API. Every visual value in this
> document resolves to a token defined here. Figma reference file:
> <https://www.figma.com/design/7HoYbh5Peur8sdpSodTyKC> — page **Screens** (node `0:1`: frames
> `01 Vazio`, `02 Enviando`, `03 Transcrevendo`, `04 Concluído`, `05 Falha`, plus modals `M1`–`M4`),
> page **Foundations** (token sheet).
>
> **Entries in this document are not yet individually traced to those frames** — see §11. Until they
> are, treat any entry that names no node id as unverified against the design, and check the frame
> before extending it.

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

- **The center column body is exactly one region**: the **thread** — a single vertical list of
  `{component.message-row}`, at `{spacing.6}` row gap, capped at `{layout.bubble}`, aligned to one
  left edge. Everything the screen has to say about an audio is a message in that list, whether the
  audio belongs to the session in this tab or to the server's history (§7 Thread). There is no
  second region, no divider inside the body and no section heading: adding one requires a new pass
  on this document, because a second region is what let the body contradict itself once already
  (§11). A **fixed overlay** is not a body region and does not count against that rule —
  `{component.toast}` is positioned against the viewport and never enters the scroll flow.
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
| `{layout.player-bar}` | 84px | Height of `{component.player-bar}`, and therefore the bottom offset any viewport-fixed overlay inside `{layout.center}` must clear. It is a token because a second component now depends on it: `{component.toast}` anchors above the player bar and must not re-derive the number. |

### Whitespace Philosophy

The panel and the rail are dense; the canvas is not. That contrast is intentional: controls should
read as a compact instrument cluster, while the thread should read as content with room to breathe.
The chat body keeps 32px of vertical padding and 40px horizontal even when a single message is
present, so the first message never looks pinned to the chrome.

Empty space in the thread is a feature, not a gap to fill. After a `Completed` summary the thread
does not backfill with suggestions, related files, or export options — the session's job is done and
it shows that by staying empty below the last message. Server history is not backfill and is not an
exception to this rule: it is not appended *after* the session, it is the part of the conversation
that happened *before* it, and it is told in the same message rows (§7 Thread).

---

## 5. Elevation & Depth

| Level | Treatment | Use |
|-------|-----------|-----|
| `{elevation.0}` | Flat fill, no border | Rail, canvas, panel backgrounds |
| `{elevation.1}` | 1px `{colors.surface.hairline}` border, no shadow | Cards, bubbles, selects, file cards, chips, player card, stepper |
| `{elevation.2}` | `0 18px 44px -6px rgba(0,0,0,0.22)` | **Modal dialogs only** |
| `{elevation.scrim}` | `{colors.ink.base}` at 42% opacity, full viewport | Behind any dialog |
| `{elevation.inverted}` | Flat `{colors.ink.base}` fill, no border, no shadow | **`{component.toast}` only** — the one element that floats over the light canvas without being a dialog |

Separation in this system comes from surface change and hairlines, not from shadow. A card on
`{colors.surface.muted}` is `{colors.surface.canvas}` plus a hairline; a card on canvas is
`{colors.surface.muted}` plus a hairline. Two adjacent surfaces always differ by a fill *and* an
edge — a fill change alone is not enough separation at these low-contrast greys.

The single shadow exists because the modal must read as detached from a busy screen; the scrim
alone would not lift it off the white canvas.

`{elevation.inverted}` exists because a toast is the *second* element in the system that floats over
content, and §5 had exactly one tool for that — the shadow — which is reserved for the dialog. The
alternative to spending the shadow is to change the surface family instead: a slab of
`{colors.ink.base}` over the light canvas separates by fill alone, needs no border and no shadow,
and keeps "one shadow, dialogs only" intact. It is also the more honest reading of what a toast is:
§1 splits the product into **dark chrome, light work**, and a transient notice about the client's
own reachability is chrome, not work — the same argument that puts `{component.api-status-card}` on
the rail. Every text pair inside it is already measured in §2 (`{colors.ink.text}` 17.24:1 and
`{colors.ink.text-muted}` 6.91:1 on `{colors.ink.base}`; `{colors.focus.ring-dark}` 8.4:1), so the
inverted surface costs no new color token.

### Stacking

The system had no z-index at all until `{component.toast}`, because nothing overlapped: dialogs use
the platform `<dialog>` element with `showModal()`, which promotes them to the browser's **top
layer**, above every z-index on the page by definition.

| Token | Value | Use |
|-------|-------|-----|
| `{z.toast}` | 40 | `{component.toast}`'s fixed host. The only z-index in the system. |

One consequence is normative, not incidental: **an open `{component.dialog}` always covers
`{component.toast}`**, scrim included, and no z-index can change that. That is the correct
composition — §8 Don't 10 gives the primary flow the loud report, and the dialog *is* the primary
flow — but a toast that dwells out of sight behind a scrim is a message the user never received. So
`{component.toast}` **holds its dwell timer while any dialog is open** (see its entry). Nothing else
in the system stacks; do not add a second z-index without adding a row here.

### Motion

Undocumented by construction — see §11. `{component.toast}` is specified with **no entrance and no
exit animation**: it appears and it disappears. The reason is the precedent §11 already set for the
indeterminate `{component.progress-bar}`, which renders statically rather than carry an invented
duration and easing. A toast is normally made noticeable by movement; this one is made noticeable by
**surface** instead — a dark slab is unmissable in an interface that is otherwise white, grey and
one orange. That is a design decision, not an omission, and it is why the inverted surface is worth
a new elevation row.

One timing value is defined, and it is not motion:

| Token | Value | Use |
|-------|-------|-----|
| `{timing.toast-dwell}` | 8000ms | How long `{component.toast}` stays before dismissing itself. |

`{timing.toast-dwell}` is a **time limit** under WCAG SC 2.2.1, not an animation, so
`prefers-reduced-motion` does not and must not shorten or extend it. Its mitigations are the pause
rules and the manual close in the component's entry. `prefers-reduced-motion` is already handled
globally in `web/app/globals.css`; with no animation declared, `{component.toast}` honours it
trivially and renders identically in both settings.

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
`{colors.text.disabled}`, cursor `not-allowed`. Used for "Transcrever" until a file is selected and
validated, and with the copy "Arquivo inválido" after a rejected client-side validation.

**`{component.button-primary-loading}`** — background `{colors.brand.primary}`, label prefixed by a
16px rotating glyph, text "Validando áudio…" / "Enviando…" / "Transcrevendo…", control is `aria-busy` and
non-interactive. When the loading state is *waiting on the server* rather than *sending bytes*
(i.e. `Processing`) or waiting on the validation Worker, the fill drops to
`{colors.surface.disabled}` with `{colors.text.disabled}` label — the button is no longer the thing
making progress.

**`{component.button-ghost}`** — background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}` border, label `{type.label}` in `{colors.text.primary}`, padding
`{spacing.2}` / `{spacing.4}`, radius `{rounded.full}`. Used for "Recomeçar" (topbar),
"Cancelar", "Fechar".

**`{component.button-danger}`** — background `{colors.semantic.danger}`, label `{type.body-lg}`
Semi Bold in `{colors.text.inverse}`, radius `{rounded.full}`. Exactly one use: "Recomeçar" inside
`{component.dialog-confirm}`.

**`{component.button-play}`** — `{size.play-button}` `{rounded.full}` circle,
`{colors.brand.primary}` fill, `{colors.text.primary}` triangle glyph. Disabled variant
`{component.button-play-disabled}`: fill `{colors.surface.hairline-strong}`, same ink glyph, whole
player card at 55% opacity.

The glyph is ink on both fills, not white: white measures 3.12:1 on `{colors.brand.primary}` and
1.56:1 on `{colors.surface.hairline-strong}` — the disabled triangle would be invisible. Ink is
5.74:1 and 11.45:1. This is §8 Don't 1 applied to a glyph, which is exactly the same rule as for a
label.

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
Contains a `{size.file-tile}` `{rounded.sm}` `{colors.brand.soft}` tile with a note glyph in
`{colors.brand.text}`; a two-line stack of file name (`{type.label}` Semi Bold,
`{colors.text.primary}`) and `{type.caption}` metadata in `{colors.text.secondary}`; a flexible
spacer; a dismiss "✕" in `{colors.text.secondary}`. The name column must carry `min-width: 0` and
truncate with an ellipsis — it must never push the dismiss control out of the card.
The metadata line shows only what has been measured: size and format always, duration **only**
where the audio element has reported it (the player). A card outside the player reads
"3,4 MB · WAV", never a guessed "2:40".

**`{component.file-validation-message}`** — one `{type.caption}` line in
`{colors.text.secondary}`, directly below `{component.file-card}`. It has three mutually exclusive
variants: "Validando arquivo de áudio…" while the Worker is active; "Arquivo validado e pronto para
envio." after acceptance; or the validator's concrete rejection/failure reason. It is persistent
selection state, not a transient announcement, so it has no `role` or `aria-live` and does not add a
third live region. During validation the panel CTA is `{component.button-primary-loading}`; after a
rejection it is `{component.button-primary-disabled}`. This inline treatment is only for failures
detected **before any request**; a rejection returned by the API remains
`{component.bubble-error}` in the thread.

The centered panel helper mirrors that state without introducing another semantic treatment. While
validation runs it reads "A extensão, o tipo, o tamanho e a assinatura estão sendo verificados fora
da interface." After rejection or Worker failure it reads "Remova o arquivo e selecione outro áudio
para continuar." Both remain `{type.caption}` in `{colors.text.secondary}` as specified by
`{component.settings-panel}`.

**`{component.select}`** — height 40px, background `{colors.surface.canvas}`, 1px
`{colors.surface.hairline}`, radius `{rounded.sm}`, padding `{spacing.3}`, value in `{type.body}`
`{colors.text.primary}`, chevron in `{colors.text.secondary}`. One instance: "Idioma → Detectar
automaticamente", and it is **disabled**: the upload endpoint carries no language parameter, so a
list of pickable languages would promise a choice the request cannot make. The field exists to
state how language is decided, not to decide it.

**`{component.field-group}`** — vertical stack, gap `{spacing.2}`, first child is a
`{type.overline}` label in `{colors.text.secondary}`. Every panel control is wrapped in one.

**`{component.text-input-focused}`** / **`{component.select-focused}`** — 2px
`{colors.focus.ring-light}` ring offset 2px outside the control's border; the resting border is
unchanged. Inside the rail, the ring is `{colors.focus.ring-dark}`.

### Thread

**`{component.message-row}`** — vertical stack, gap `{spacing.2}`, width hug up to
`{layout.bubble}`. Header: `{size.glyph-circle}` `{rounded.full}` glyph circle + author in `{type.label}` Semi Bold
`{colors.text.primary}` + timestamp in `{type.caption}` `{colors.text.secondary}`.

**`{component.bubble}`** — background `{colors.surface.muted}`, 1px `{colors.surface.hairline}`,
radius `{rounded.md}`, padding `{spacing.3}` `{spacing.4}`, internal gap `{spacing.2}`, width
`{layout.bubble}` fixed. Neutral state lines ("Na fila para transcrição") plus a right-aligned
`{type.mono}` status word in `{colors.text.secondary}`.

**`{component.bubble-upload}`** — as `{component.bubble}` but background
`{colors.surface.canvas}`; hosts a `{component.file-card}` row and, once stored, the
`{type.mono}` id line and a `201 Created` `{component.badge-success}`.

**`{component.bubble-loading}`** — as `{component.bubble}` plus a `{size.accent-rail}` left accent rail in
`{colors.brand.primary}` (upload) or `{colors.semantic.info}` (transcription). Contains: a `{size.glyph-circle-sm}`
soft-tinted glyph circle, a `{type.body}` Medium action line, a right-aligned `{type.mono}`
percentage or status word, a `{component.progress-bar}`, and a `{type.caption}` explanation in
`{colors.text.secondary}`. **This is the component the loading test asserts on.**

**`{component.bubble-summary}`** — background `{colors.surface.canvas}`, `{size.accent-rail}` left accent rail in
`{colors.brand.primary}`, radius `{rounded.md}`. Body is the summary in `{type.body-lg}`
`{colors.text.primary}`. Footer row: `{component.badge-mono}` with the detected language, then
`{type.mono}` `"201 / 500 caracteres"` in `{colors.text.secondary}`, then a right-aligned
`{type.caption}` provenance line "Whisper tiny · resumo extrativo".

**`{component.bubble-error}`** — background `{colors.semantic.danger-soft}`, 1px `{colors.semantic.danger-border}` border,
`{size.accent-rail}` left accent rail in `{colors.semantic.danger}`. Title `{type.body-lg}` Semi Bold in
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

**`{component.empty-state}`** — centered on both axes: `{size.glyph-circle-lg}` `{colors.brand.soft}`
circle with a note glyph in `{colors.brand.text}`, `{type.heading}` headline "Nenhum áudio ainda",
`{type.body}` subline in `{colors.text.secondary}` capped at `{size.measure-narrow}` and centered.

#### History messages — an audio the server already holds

The server keeps every audio it has stored, and `GET /api/audios` returns them. **They are not a
list.** The Figma's chat body (node `5:47`) contains messages and nothing else — no section, no
heading, no bordered card — so an audio the server processed is rendered as **one
`{component.message-row}` in the same thread**, above the session's own messages. It reuses the
entries above and introduces no new component.

Placement and ordering:

- History messages come **first**, oldest first, then the messages of the session in this tab. The
  API returns newest first; the client reverses it, because a conversation reads forward in time.
- The audio of the session currently on screen is **dropped from the history** — it is already
  being told live and must not be told twice.
- `{component.empty-state}` and the history are decided from **the same array, in the same
  component**: the empty state renders only when the session is `idle` **and** the history is
  empty. It is structurally impossible for "Nenhum áudio ainda" to sit above a rendered audio.
- Timestamp is the audio's `createdAtUtc`, `HH:mm`, `{type.caption}` `{colors.text.secondary}` —
  the same header as every other row.
- **No `{component.status-chip}` anywhere in a history message.** The chip is topbar chrome for the
  live session. Stage is carried the way every other thread row carries it: the literal API word in
  `{type.mono}`.
- **No `{component.progress-bar}`.** The server measures neither background stage, and §8 Don't 3
  forbids a fabricated quantity. The bar stays a live-session component.

One variant per server state, each a full entry:

**`{component.message-row}` · history compressing** — `ProcessingStatus` is `Pending` or
`Processing`. Circle `{colors.surface.muted}` with a `○` glyph in `{colors.text.secondary}`, author
"Sistema", body `{component.bubble}`. The bubble holds one row, gap `{spacing.2}`: the original file
name plus the stage, `{type.body}` in `{colors.text.primary}`, `min-width: 0` and ellipsis-truncated
(§8 Do 8); then a right-aligned, non-shrinking `{type.mono}` literal `ProcessingStatus` value in
`{colors.text.secondary}`. Copy: `"<arquivo> — comprimindo"` for `Processing`,
`"<arquivo> — na fila para compressão"` for `Pending`.

**`{component.message-row}` · history compression failed** — `ProcessingStatus` is `Failed`. Circle
`{colors.semantic.danger-soft}` with a `✕` glyph in `{colors.semantic.danger}`, author "Sistema",
body `{component.bubble-error}` **without its action row**: title `{type.body}` Semi Bold in
`{colors.semantic.danger}` reading `"Não foi possível comprimir <arquivo>"`, then a
`{component.code-line}` carrying the raw `processingError`, or
`"O servidor não informou o motivo."` when the server sent none. No "Tentar novamente" and no
"Enviar outro áudio": there is no reprocess endpoint, and the browser no longer holds the file, so
either control would be a promise the product cannot keep.

**`{component.message-row}` · history summarized** — `SummaryStatus` is `Completed`. Circle
`{colors.brand.soft}` with a `✓` glyph in `{colors.brand.text}`, author "Resumo", body
`{component.bubble-summary}` with one addition and one omission. Addition: a first line with the
original file name, `{type.label}` Semi Bold in `{colors.text.primary}`, `min-width: 0`,
ellipsis-truncated — the live session's summary needs no such line because the file was named two
rows above, and a history summary has no such row. Omission: **no provenance caption**
("Whisper tiny · resumo extrativo") — it describes how this build transcribes, it is already stated
once per screen by the live summary, and repeating it on every historical row is noise. Body and
footer are unchanged: the summary in `{type.body-lg}` `{colors.text.primary}`, then a wrapping
footer row at `{spacing.2}` of `{component.badge-mono}` with the detected language and `{type.mono}`
`"201 / 500 caracteres"` in `{colors.text.secondary}`. Never clamped, never behind a disclosure —
500 characters is ~6 lines at this measure and the visible count already says how much text there
is.

**`{component.message-row}` · history summary failed** — `SummaryStatus` is `Failed`. Identical to
*history compression failed* in surface, circle, author and glyph; the title reads
`"Não foi possível resumir <arquivo>"` and the `{component.code-line}` carries `summaryError` (same
fallback string). Also no action row, for the same reason.

**`{component.message-row}` · history stored, no summary** — `SummaryStatus` is `Disabled`, or the
audio is compressed and still queued for the summary worker. Identical in every property to *history
compressing*; only the copy and the literal word change. Copy:
`"<arquivo> — armazenado, resumo desativado no servidor"` for `Disabled`,
`"<arquivo> — aguardando o resumo"` otherwise; right-aligned `{type.mono}` literal `SummaryStatus`
value. **Neutral, never red** — `Disabled` means the server was configured not to summarize, which
is not an outcome (§2, §8).

**Announcer split.** The screen has exactly two live regions and they never carry the same content:
the thread (`role="log"`, `aria-live="polite"`) announces everything that is a message — the
session's transitions and the history rows alike, since they are the same rows — and
`{component.toast}` (`role="status"`) announces screen-level transient notices that no message row
exists for. Two polite regions queue rather than collide; what must never happen is the same fact
spoken by both, which is why a failed history fetch lives in the toast and never becomes a message.

### Status & Badges

**`{component.status-chip}`** — pill, radius `{rounded.full}`, padding `{spacing.1}`
`{spacing.3}`, 6px dot + `{type.label}` Medium. Eight variants, one per state a surface can be in:

| Variant | Dot / label color | Background | Copy |
|---------|------------------|------------|------|
| `{component.status-chip-idle}` | `{colors.text.secondary}` | `{colors.surface.muted}` | "Aguardando arquivo" |
| `{component.status-chip-uploading}` | `{colors.brand.text}` | `{colors.brand.soft}` | "Enviando…" |
| `{component.status-chip-processing}` | `{colors.semantic.info}` | `{colors.semantic.info-soft}` | "Processando" |
| `{component.status-chip-compressing}` | `{colors.semantic.info}` | `{colors.semantic.info-soft}` | "Comprimindo" |
| `{component.status-chip-summarizing}` | `{colors.semantic.info}` | `{colors.semantic.info-soft}` | "Resumindo" |
| `{component.status-chip-completed}` | `{colors.semantic.success}` | `{colors.semantic.success-soft}` | "Concluído" |
| `{component.status-chip-failed}` | `{colors.semantic.danger}` | `{colors.semantic.danger-soft}` | "Falhou" |
| `{component.status-chip-disabled}` | `{colors.text.secondary}` | `{colors.surface.muted}` | "Resumo desativado" |

`{component.status-chip-compressing}` and `{component.status-chip-summarizing}` name the server's
**two** background stages (`ProcessingStatus` then `SummaryStatus`), which "Processando" alone
cannot tell apart. They share the info pair rather than inventing a hue — §8 Don't 6.

**Both are currently unrendered.** They were added for a per-audio card that this document specified
and the product never had; that region is gone (§11), and the thread names a stage with the literal
API word in `{type.mono}`, not with a chip. `web/components/ui/Chip.tsx` still ships both variants,
so the entries stay here — the document describes the code, and an undocumented shipped variant is
worse than a documented unused one. The six chips the screen actually renders are the other six,
all from `{component.topbar}`, one per `Phase`. If a future pass finds no caller for these two, the
deletion is in the code first and here second.

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

**`{component.api-status-card-unreachable}`** — same surface, radius, host line and metrics; the
dot becomes 8px `{colors.ink.text-muted}` (6.91:1 on `{colors.ink.raised}`) and the label becomes
"API sem resposta". A neutral dot, **not** `{colors.semantic.danger}`: §2 measures no danger value
against the rail surfaces, and the rail is chrome — it reports reachability, it does not raise an
alarm the thread has already raised. No `role`, no live region.

This variant exists because the resting card asserts "API online" unconditionally, so on the one
screen where the API is demonstrably down the rail states the opposite in the only green the system
owns. Its trigger is the last request the client made: any failed fetch (the session's own requests
or the `GET /api/audios` that loads the history) puts the card in this state, any successful one returns it to `{component.api-status-card}`. There
is no health endpoint and none is implied — the card reports *our last attempt*, which is why the
copy is "sem resposta" and not "offline". See §11: designed, not yet implemented.

**`{component.topbar}`** — 64px, `{colors.surface.canvas}`, 1px bottom `{colors.surface.hairline}`,
padding-x `{spacing.6}`. Left: `{type.heading}` title. Right: the current
`{component.status-chip}` then `{component.button-ghost}` "Recomeçar".

### Panel & Player

**`{component.settings-panel}`** — 320px, `{colors.surface.muted}`, 1px left
`{colors.surface.hairline}`, padding `{spacing.5}`, field gap `{spacing.5}`. Order is fixed: header
→ Áudio → Idioma → Resumo → Estado (only once an upload exists) → flexible spacer → CTA → helper
line in `{type.caption}` `{colors.text.secondary}`, centered. When a file is selected, the Áudio
group composes `{component.file-card}` followed by `{component.file-validation-message}` at the
group's existing `{spacing.2}` gap.

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

**`{component.toast}`** — the system's only transient notification. It exists for exactly one class
of message: a **screen-level notice that no message row exists for and that no region should have to
grow a body to carry**. Today it has exactly one producer — `GET /api/audios` failed and the screen
holds **no history to show**, so nothing on screen carries the failure and no message row can (§7
Thread, History messages). It is screen-level, not thread-level: it belongs to the screen
composition, not to the component whose fetch failed.

When the fetch fails but history rows are already on screen, the toast does **not** fire: those rows
are still the last thing the server said, they keep saying it, and an 8-second notice that expires
while the rows it qualifies stay visible is worse than silence. The persisting half of that fact is
`{component.api-status-card-unreachable}` in the rail, which is driven by the same signal (§8 Do 9).

*Host.* A permanently-mounted, `position: fixed` layer, `pointer-events: none`, `z-index`
`{z.toast}`, empty when there is no notice. It is fixed at **every** breakpoint — never
`sticky`, never in flow. That is the point of the component: a failure that has nothing to show must
claim no layout.

*Anchor and offsets, per §9 breakpoint.* The host spans the horizontal extent of `{layout.center}`
and sits at its bottom edge, so the notice appears next to the region it is about and inside the
column that owns the work:

| Breakpoint | left | right | bottom | Inner padding |
|---|---|---|---|---|
| `{bp.desktop}` | `{layout.rail}` (240px) | `{layout.panel}` (320px) | `{layout.player-bar}` (84px) | `{spacing.6}` x / `{spacing.4}` bottom |
| `{bp.laptop}` | the rail's rendered width | 0 | `{layout.player-bar}` | `{spacing.6}` x / `{spacing.4}` bottom |
| `{bp.tablet}` | the rail's rendered width (64px icon rail) | 0 | `{layout.player-bar}` | `{spacing.4}` |
| `{bp.mobile}` | 0 | 0 | 0 | `{spacing.4}` |

**What it must never cover**, stated as the reason for each offset: `{component.player-bar}` and the
`{component.player-card}` inside it — the bottom offset is exactly `{layout.player-bar}` and the
notice sits *above* it, never over the transport controls; `{layout.panel}` /
`{component.settings-panel}` and its CTA — the right offset is exactly `{layout.panel}` at
`{bp.desktop}`, and at `{bp.laptop}` and below the panel is a drawer/bottom sheet whose open state
is a dialog-class surface and covers the toast legitimately; `{component.sidebar}` and
`{component.api-status-card}` — the left offset is the rail's width, so the toast never sits over
the one element that carries the *persisting* form of the same fact; `{component.topbar}` and its
`{component.status-chip}` — the toast is bottom-anchored and cannot reach them.

At `{bp.laptop}` and below the right offset is 0 because the panel has left the column;
at `{bp.mobile}` the bottom offset is 0 + `{spacing.4}` padding because `{component.player-bar}`
is in flow there and reserves nothing. When §9's docked mobile player bar ships, that bottom offset
becomes `{layout.player-bar}` and this table is what must change — not a number in a component.

**Implementation mapping, stated because the shipped shell is coarser than §9.** The build has
exactly one shell breakpoint today: `xl:` (1280px) is `{bp.desktop}`, and *everything below it* is
the single stacked column — the rail is not rendered, the panel is stacked under the centre column,
and `{component.player-bar}` is in flow. So `{component.toast}` ships with **two** offset sets, not
four: the `{bp.desktop}` row above at `xl:` and up, and the `{bp.mobile}` row below it. The
`{bp.laptop}` and `{bp.tablet}` rows are the design intent for when §9's intermediate shells are
actually built; they are not dead prose, they are the target, and they are listed here so that
building those shells does not require re-deciding where the toast goes.

*Surface.* `{elevation.inverted}`: flat `{colors.ink.base}` fill, **no border, no shadow**, radius
`{rounded.md}`, padding `{spacing.3}` `{spacing.4}`, internal gap `{spacing.3}`. Width
`width: 100%` of the host, capped at `{layout.bubble}` (624px), left-aligned — the same measure as
the thread's message rows (§8 Do 6), so the notice lines up with the conversation it is about. The
message column carries `min-width: 0` and **wraps** at that measure; it never truncates and never
ellipsises, because a notice the user cannot finish reading is not a notice. The action does not
wrap its own label (`shrink-0`); when the row is too narrow for message + action, the whole row
wraps and the controls drop to a second line under the message.

*Contents, in order.* (1) The message, `{type.body}` in `{colors.ink.text}` (17.24:1 on
`{colors.ink.base}`, §2). (2) The action, `{component.button-ghost-rail}` — required here, because
`{component.button-ghost}` is a `{colors.surface.canvas}` control and is illegal on an ink surface.
(3) The dismiss "✕" in `{colors.ink.text-muted}` (6.91:1 on `{colors.ink.base}`, §2), `{type.label}`,
`{rounded.full}`, hover `{colors.ink.raised}`, accessible name "Dispensar aviso" — the glyph is
`aria-hidden` per §6. Focus inside the toast uses `{colors.focus.ring-dark}` (8.4:1 on
`{colors.ink.base}`), i.e. the toast is a rail-family surface for focus purposes.

**`{component.button-ghost-rail}`** — `{component.button-ghost}` translated to the ink family:
background `transparent`, 1px `{colors.ink.hairline}` border, label `{type.label}` in
`{colors.ink.text}`, radius `{rounded.full}`, padding `{spacing.2}` / `{spacing.4}`, hover
background `{colors.ink.raised}` — which is the *documented* rail hover step (§7 hover policy:
`{colors.ink.base}` → `{colors.ink.raised}`), not a new one. It is a variant, not a second button
language, and it exists only because `{component.toast}` is the system's only ink surface that
carries a control.

*Tone.* **One tone only — neutral/informational.** There is deliberately no danger variant. §8
Don't 10 assigns the danger surface, the `role="alert"` and the diagnosis to the primary flow, and
the primary flow's failure is already a `{component.bubble-error}` in the thread plus a
`{component.dialog}` over it. A red toast would be the third report of one root cause, in the
loudest position on the screen, for the least important of the three. Any future request for a
danger tone must first list every surface that is red at the same instant (§8 Don't 10); if the
answer is "none", the message probably belongs in the thread instead.

*Multiplicity.* **At most one toast exists at a time.** A new notice replaces the current one and
restarts its dwell. There is no stack, no queue and no vertical offset arithmetic, because there is
exactly one producer; a stack is undesigned and adding a second producer requires designing it
(§11).

*Dismissal.* **Both**, and both are required:

- **Auto** — the toast dismisses itself after `{timing.toast-dwell}` (8000ms). Eight seconds rather
  than the usual five because this toast carries an *action*: the dwell must cover reading the
  sentence and travelling to the control.
- **Manual** — the "✕". Always present. It is what makes the auto-dismiss legal to a user who reads
  slowly and to a user who does not want the notice at all.

*Hold rules* (the dwell is paused, not shortened or restarted-in-place):

1. **Pointer over the toast** — pause. The user is reading or aiming at the action.
2. **Focus anywhere inside the toast** — pause. A keyboard user tabbing to "Recarregar a lista" must
   not have it disappear under the caret. This is the WCAG SC 2.2.1 mitigation for the time limit.
3. **Any `{component.dialog}` open** — pause. `showModal()` puts the dialog in the browser top
   layer, above `{z.toast}` and behind `{component.scrim}`, so the toast is unreadable; letting the
   timer run would spend the notice on a screen the user cannot see (§5 Stacking).

On release of all three holds the dwell restarts from full rather than resuming its remainder — a
deliberate generosity, and one less piece of state.

*Motion.* **None.** No entrance, no exit, no slide, no fade — see §5 Motion for the reasoning and
§11 for the gap this leaves open. `prefers-reduced-motion` is honoured trivially and the component
renders identically in both settings. `{timing.toast-dwell}` is a time limit, not motion, and
`prefers-reduced-motion` must not change it.

*ARIA contract.*

- The **host** carries `role="status"` and `aria-atomic="true"`, and is **mounted from first render
  and left in the DOM when empty**. A live region injected at the same moment as its content is
  frequently not announced; the host must pre-exist so inserting the notice is a mutation.
- `role="status"` and **not** `role="alert"`. `alert` is assertive: it interrupts. Nothing here
  failed that the user initiated, the region it describes is secondary, and §8 Don't 10 reserves the
  alert for the primary flow.
- It composes with the thread's `role="log"` / `aria-live="polite"` because the two never carry the
  same content: the thread announces session state, the toast announces screen-level notices that
  have no message row. Two polite regions queue; they do not double-announce. No third live region
  may be added: a second announcer over the same content is how the same fact gets spoken twice.
- The toast **never moves focus**. `role="status"` that steals focus is a focus trap with no exit.
- The toast is reachable by Tab in normal DOM order and is not `Esc`-dismissible; `Esc` belongs to
  `{component.dialog}`.
- At `{bp.tablet}` and below both controls take a 44×44px minimum hit area per §9, keeping their
  `{type.label}` glyph and label sizes.

*Copy* (Portuguese, verbatim):

| Element | String |
|---|---|
| Message (history unreachable, nothing on screen) | "Não foi possível carregar os áudios processados." |
| Action | "Recarregar a lista" |
| Dismiss accessible name | "Dispensar aviso" |

The message names no cause. "Verifique se a API está no ar" belongs to `{component.bubble-error}`,
where the user's own action failed. The action is "Recarregar a lista" and never "Tentar novamente"
— §8 Don't 11.

*Ownership in the composition.* The toast is owned by the **screen**, not by the thread. It mounts
as the last child of the page root, after `{component.settings-panel}`, so tab order reaches it
after all page content. Its state is one nullable notice value held by the screen — not a global
store, not a context, not a provider. The producer is an effect on the screen that watches "the
history fetch failed **and** the screen holds no history"; the consumer is the presentational
component, which owns only its own dwell timer and hold flags.
See §11 for what a second producer would require.

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
`{component.badge-mono}` language + `{type.mono}` character count. No elapsed time: nothing in the
API or the client measures how long the transcription took, and §8 Don't 3 forbids showing a
number the system did not observe.

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
9. **Sort a failure by its lifetime before you place it.** An *event that is over* ("the request I
   just made did not come back", with nothing on screen it describes) gets a transient overlay —
   `{component.toast}` — which claims no layout and dismisses itself. A *fact about the system*
   ("the API is not answering") goes to chrome — `{component.api-status-card-unreachable}` — where
   it persists for as long as it is true. A *transition of the user's own audio* is neither: it is
   a `{component.message-row}`, permanently. One server event can legitimately produce different
   placements in different states, and forcing them to match for symmetry breaks one of them.

10. **Ask what language the product already speaks before designing a new one.** A requirement of
    the form "show X for each item" is a request for content, not for a component. This screen is a
    conversation, so the answer was a message row it already had. Find the source frame the design
    derives from and check what it actually contains *before* opening a new entry in this document
    (§11, traceability).

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
   wait legible. This scopes `{component.toast}` and does not license it: every backend transition
   of *the user's own audio* is a `{component.message-row}` in the thread, permanently, and no toast
   may stand in for one. `{component.toast}` carries only screen-level notices that have **no**
   message row and never will — today, exactly one: the `GET /api/audios` history fetch failing
   while the screen holds no history to show. Before routing anything new to it, ask whether it is a
   transition of an audio; if it is, it is a row.
9. Don't use a radius outside the four defined values, and never round a modal at
   `{rounded.md}` or a chip at anything but `{rounded.full}`.
10. **Don't specify a secondary region's error state without composing it against the whole screen
    failing.** The most common cause of a secondary fetch failing is the same cause that just
    failed the primary flow, so the two error states render *together*, and a per-region spec
    produces one root cause reported twice in the same viewport. The primary flow owns the danger
    surface, the `role="alert"` and the diagnosis; a secondary region gets a quiet
    `{colors.text.secondary}` `{type.body}` line and nothing else. Before shipping any error entry,
    list every other surface that is red at the same instant.
11. **Don't give two controls the same accessible name unless they invoke the same action.**
    "Tentar novamente" on `{component.bubble-error}`, in the failure dialog and in
    `{component.settings-panel}` is one action with three affordances and is correct. A control
    that reloads a list is a different action and takes a different name
    ("Recarregar a lista"). Name the action, not the mood.
12. **Don't draw a boundary around emptiness.** A secondary region with nothing to show renders
    **nothing at all** — no divider, no heading, no vertical rhythm, no padding. A `border-t`
    announces "a region starts here"; spending one, plus `{spacing.12}` of separation and
    `{spacing.8}` of padding, to say that there is nothing under it produces debris on a large empty
    canvas, and it is worse without a heading, because the rule promises a region that never names
    itself.
    The trap this rule exists to close: **demoting an error's visual weight does not answer whether
    it belongs in the document flow.** A failed-fetch notice in a secondary region was once
    correctly demoted from a red box to a quiet grey line and was still wrong, because the demotion
    left the section chrome around it untouched. Weight and placement are two questions. Ask the
    second one every time you answer the first: *if this region had nothing to say, would it still
    take up space?* If yes, the region — not the message — is the defect. And there is a third
    question behind both, which is the one this document learned last: *should this region exist at
    all?* Two rounds were spent on the weight and the placement of a region the design never had
    (§11, traceability).

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
  header stays a single row (glyph + author + timestamp) and the timestamp truncates first. History
  messages are message rows and inherit this line exactly — there is no second rule for them, and
  the thread never collapses, never moves column and never becomes a disclosure at any breakpoint.
- **Toast**: `{component.toast}` never changes surface, tone or content across breakpoints; only its
  fixed offsets change, per the table in its §7 entry. It tracks `{layout.center}` at
  `{bp.desktop}` (left `{layout.rail}`, right `{layout.panel}`, bottom `{layout.player-bar}`), drops
  the right offset once `{layout.panel}` becomes a drawer, and goes edge-to-edge minus `{spacing.4}`
  gutters at `{bp.mobile}`. Its message wraps rather than truncating at every width, and both its
  controls take a 44×44px hit area at `{bp.tablet}` and below.
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
  **`{component.toast}` is now a named item in this gap.** It is specified with *no* entrance and
  *no* exit animation, deliberately and explicitly, and it is made noticeable by its inverted
  surface instead. That is a working answer, not the right one: a toast is the component in this
  system that would benefit most from a 120ms fade-and-rise, and the reason it does not have one is
  that this document owns no duration and no easing token. §5 Motion defines the one timing value
  the component genuinely needs (`{timing.toast-dwell}`, a time limit, not motion) and nothing else.
- **Reference harvest limits.** The Mistral "Speech to text" and Hume screens were harvested from
  static screenshots only — no hover states, no mobile views, no authenticated chrome and no
  computed CSS were available. The palette, layout split and pill/hairline language are derived
  from those images; the exact hexes are this system's own, chosen to satisfy the contrast
  measurements in §2 rather than sampled pixel-for-pixel.
- **Screens not designed**: none are promised. The rail used to advertise "Biblioteca",
  "Arquivos" and "Chaves de API"; those entries were removed on the owner's instruction because
  nav that leads nowhere is a broken promise. Client-side rejections (wrong extension, MIME,
  > 50 MB, empty file or incompatible signature) use the inline
  `{component.file-validation-message}` specified in §7. Server-side upload/decode failures still
  have no dedicated dialog and surface through `{component.bubble-error}`.
- **Multi-file / multi-session behavior is only half designed.** The thread still models exactly
  one *live* audio at a time, and queueing several uploads has no design. Reading back previous
  audios **is** designed now — §7 Thread, History messages — but only as read-only messages: there
  is no way to reopen a past audio in the thread, no way to play it (the player holds the locally
  selected file), and no way to reprocess it. Those need endpoints the API does not have. The
  history is also rendered whole: every audio `GET /api/audios` returns becomes a row, so at a few
  hundred audios the conversation is a very long scroll. A cap, a "carregar mais" or a date break is
  undesigned — and, this time, must be checked against the Figma before it is specified.
- **`docs/DESIGN.md` is not traceable to its source frames.** No entry in this document names the
  Figma node it derives from, so a component invented at a desk and a component read off a frame are
  indistinguishable once written down — both are prose in the same voice. That is not hypothetical:
  an entire "Processed List" region (a section, a header, five card variants, an empty state, two
  error states, two chip variants and a render truth table) was specified here, defended across two
  rounds of review, and implemented, before a human opened the Figma and found that the **Screens**
  page (node `0:1`) has nine frames — `01 Vazio`, `02 Enviando`, `03 Transcrevendo`, `04 Concluído`,
  `05 Falha`, `M1`–`M4` — and not one of them contains a list. The requirement it was invented for
  ("cada item do áudio processado mostrará o resumo do áudio") was satisfied all along by a message
  in the chat body (node `5:47`). No process step caught it, because nothing in this document could
  be checked against anything.
  **Remedy**: every `{component.x}` entry carries the Figma node id it derives from, and an entry
  with no node id is explicitly marked as *invented, unverified* so a reviewer can see the
  difference. The thread entries can start today — Chat body `5:47`, `{component.bubble-summary}`
  `5:260`, message rows `5:48` (Você) / `5:68` (Sistema · Pending) / `5:240` (Sistema · Completed) /
  `5:254` (Resumo). Doing the same for the rail, the panel, the player and the dialogs is a
  `/darkdesign` pass over the Figma file, not a code decision.
- **Whole-screen failure is specified but only partly drawn.** No frame shows the composite — the
  state where `{component.bubble-error}`, the failure dialog, `{component.toast}` and
  `{component.api-status-card-unreachable}` are all live at once was found by a human opening the
  page in a browser, **three times** — once for a duplicated red box, again for the orphaned grey
  line the first fix left behind, and again for an empty state rendered directly above two audios.
  None of the three was visible to a passing component test. Every *other* multi-surface failure
  combination (rejected file + history error; `Disabled` + history error) is still unreviewed prose.
- **`{component.api-status-card-unreachable}` ships, but only at `{bp.desktop}`.** The rail is
  rendered from `{bp.desktop}` up and is hidden below it, so below 1280px the screen has **no**
  persisting statement of reachability at all. That matters more now than it did: §7 hands the
  *persisting* half of a history-fetch failure to this card and the *transient* half to
  `{component.toast}`, so on a narrow viewport the persisting half has nowhere to render and the
  only report is an 8-second toast. §9 already says the rail's contents move into the hamburger menu
  below `{bp.tablet}` — including the API status card — but that menu is not implemented, and a
  status card inside a closed menu is not a persisting statement anyway. This needs a
  `/darkdesign` pass on where reachability lives on a narrow screen; it is not a code decision.
- **`{component.toast}` has exactly one producer and no design for a second.** One notice at a
  time, no stack, no queue, no vertical offset arithmetic, no priority rule between two notices, no
  design for what happens when a notice arrives while another is held by hover. All of that is
  affordable to leave undesigned only while the producer count is one. Adding a second producer is a
  `/darkdesign` pass on this entry, not a prop.
- **`{component.toast}` and `{component.button-ghost-rail}` are not drawn in Figma**, like the four
  breakpoints — see the traceability gap above; these two are the entries most in need of the
  *invented, unverified* mark. In particular the composite that matters most is
  undrawn: `{component.dialog}` open in the browser top layer with the toast alive and held
  underneath its scrim. That state is specified in §5 Stacking and verified by nobody's eye.
- **The waveform has no real data source.** The API exposes no peak data, so the drawn bars are
  proportional decoration. §7 forbids re-randomizing them, but the derivation from actual audio
  peaks is not specified.
