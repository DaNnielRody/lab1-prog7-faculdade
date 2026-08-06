# Tickets — Tela de transcrição (frontend)

Fatias tracer-bullet do [PRD](PRD-frontend-transcription.md). Cada fatia é entregável sozinha.

---

## T1 — CORS na API

**blocking:** —
**Agentes:** df-testing → df-backend

O browser não alcança a API sem política de CORS. Seguir o padrão de Options do repo.

- `src/AudioApi/Options/CorsOptions.cs` — `public const string SectionName = "Cors"`,
  `AllowedOrigins: string[]` (padrão `http://localhost:3000`).
- `Program.cs`: `builder.Services.Configure<CorsOptions>(...)`, `AddCors` com política nomeada,
  `app.UseCors(...)` antes dos endpoints.
- `appsettings.json`: seção `Cors`.
- Teste: `tests/AudioApi.Tests/CorsTests.cs` — request com `Origin` permitido recebe
  `Access-Control-Allow-Origin`; origem não listada não recebe.

**Aceite:** `dotnet test` verde; gate de sandbox verde.

---

## T2 — Scaffold `web/` + tokens do DESIGN.md

**blocking:** —
**Agentes:** df-architecture → df-frontend

- Next.js App Router + TypeScript em `web/` (sem `src/`, sem ESLint extra além do padrão).
- Tailwind v4; `web/app/globals.css` declara **todos** os tokens de `docs/DESIGN.md` §2–§6 num
  bloco `@theme` (cores, escala tipográfica, espaçamento 4px, 4 raios, sombra do dialog).
- Fontes Inter + JetBrains Mono via `next/font/google`.
- Vitest + React Testing Library + jsdom; `npm run test`.
- `web/lib/types.ts` — espelho TS de `AudioFileDto` e `AudioSummaryDto`.
- `.gitignore`: `web/node_modules`, `web/.next`.

**Aceite:** `npm run build` e `npm run test -- --run` verdes; nenhum hex/px cru fora do `@theme`.

---

## T3 — Primitivos de UI (`web/components/ui/`)

**blocking:** T2
**Agentes:** df-design → df-frontend → df-testing

Um arquivo por família `{component.x}`, props tipadas, função pura de props:
`Button` (primary/ghost/danger + disabled/loading), `Chip` (5 variantes de status + disabled),
`Badge`, `ProgressBar` (determinada/indeterminada), `MessageRow`, `Bubble`
(neutral/upload/loading/summary/error), `FileCard`, `Dropzone` (+drag-over), `Select`, `Stepper`,
`Waveform`, `Dialog` (+header/footer/scrim), `EmptyState`, `CodeLine`.

Acessibilidade: `role="progressbar"` com/sem `aria-valuenow`, `aria-busy` no loading,
foco visível com o token de ring, dialog com trap de foco e `Escape`.

**Aceite:** teste de render por primitivo crítico (Button, Chip, ProgressBar, Bubble, Dialog);
zero valor visual fora dos tokens.

---

## T4 — Cliente HTTP + máquina de fases

**blocking:** T2
**Agentes:** df-testing → df-frontend

- `web/lib/api.ts`: `uploadAudio(file, onProgress)` via `XMLHttpRequest` (progresso real, mapeia
  400/422/5xx para erro tipado com mensagem em português) e `getSummary(id)` via `fetch`.
- `web/lib/useTranscription.ts`: fases do PRD, polling 2s, parada em fase terminal, teto de 5 min,
  limpeza no unmount, `reset()` para "Recomeçar", thread append-only.

**Aceite:** testes de unidade com XHR/fetch fakes cobrindo: progresso emitido, `Pending`→
`Processing`→`Completed`, `Failed`, `Disabled`, erro de upload, polling parado no terminal.

---

## T5 — Composição da tela + modais

**blocking:** T3, T4
**Agentes:** df-design → df-frontend

`web/components/transcription/`: `Sidebar`, `Topbar`, `Thread`, `SettingsPanel`, `PlayerBar`,
`UploadDialog`, `CompletedDialog`, `FailedDialog`, `ConfirmRestartDialog`; montados em
`web/app/page.tsx`. Cinco fases renderizadas conforme o Figma; player toca o arquivo local.

**Aceite:** as 5 fases e os 4 modais renderizam; `npm run build` verde.

---

## T6 — Testes de aceite do MR

**blocking:** T5
**Agentes:** df-testing

- **`web/__tests__/loading-state.test.tsx`** — requisito do MR: ao submeter o arquivo, o
  componente de carregamento (`{component.bubble-loading}` + `progressbar`) **está na tela**
  enquanto o upload não resolve, e some quando resolve.
- Sucesso: `Completed` mostra o resumo e `N / 500 caracteres`.
- Erro: `Failed` mostra a mensagem de erro e o botão "Tentar novamente".

**Aceite:** os três testes falham se a UI correspondente for removida.

---

## T7 — README + verificação manual

**blocking:** T6
**Agentes:** df-frontend

`web/README.md` + seção no `README.md` raiz: como subir API (`:5218`) e front (`:3000`), variável
`NEXT_PUBLIC_API_BASE_URL`, e o passo a passo de verificação manual ponta a ponta.

**Aceite:** comandos do README funcionam numa máquina limpa.
