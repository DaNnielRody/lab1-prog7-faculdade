# PRD — Tela de transcrição (frontend)

Status: aprovado no grill de `/darkagent` · Área: [Frontend](../../.claude/contexts/frontend/CONTEXT.md)
Design: [`docs/DESIGN.md`](../DESIGN.md) · Figma: <https://www.figma.com/design/7HoYbh5Peur8sdpSodTyKC>

## Problema

A AudioApi só tem Swagger. A atividade da semana pede uma aplicação web que consome a API:
formulário de upload de áudio, estado de carregamento durante o upload, e mensagem simples de
sucesso ou erro. O MR precisa de teste verificando que o componente de carregamento aparece
enquanto o arquivo está sendo enviado.

## Solução

Um cliente Next.js (App Router, TypeScript) em `web/`, com **uma tela**: rail escuro de navegação,
thread central que registra cada transição real do backend como uma mensagem, painel de
configurações à direita (upload, idioma, regra do resumo, estado) e barra de player embaixo.
O visual inteiro está especificado em `docs/DESIGN.md`; nenhuma decisão visual é tomada no código.

## Escopo

**Dentro**

1. Scaffold Next.js + TypeScript + Tailwind v4 em `web/`, com os tokens do DESIGN.md como CSS
   variables, fontes Inter + JetBrains Mono, e Vitest + React Testing Library configurados.
2. Biblioteca de primitivos em `web/components/ui/` — um arquivo por família `{component.x}`:
   Button, Chip, Badge, ProgressBar, Bubble, MessageRow, FileCard, Dropzone, Select, Stepper,
   Waveform, Dialog, EmptyState.
3. Cliente HTTP (`web/lib/api.ts`) e máquina de fases (`web/lib/useTranscription.ts`):
   upload via `XMLHttpRequest` com progresso real, polling de `GET /api/audios/{id}/summary`.
4. Composição da tela e dos 4 modais (escolher arquivo/drag-over, concluído, falha, recomeçar).
5. Testes: **o componente de carregamento aparece durante o upload** (requisito do MR), mais
   sucesso, erro e o teto de 500 caracteres exibido.
6. CORS na API (`Options/CorsOptions.cs` + política em `Program.cs`), sem o qual o browser não
   alcança nenhum endpoint.

**Fora**

- Telas "Biblioteca", "Arquivos", "Chaves de API" — existem na nav como destino futuro, sem frames
  no Figma e sem rota.
- Download, export, compartilhamento — proibidos por `docs/DESIGN.md` §8.
- Tema escuro da área de trabalho, breakpoints móveis pixel-perfect, motion — listados como gaps
  conhecidos no DESIGN.md §11.
- Fila de múltiplos áudios: a tela carrega **um** áudio por vez.

## Fases (estado do cliente)

`idle → uploading → (pending → processing)* → completed | failed | disabled`

| Fase | Origem | UI |
|------|--------|----|
| `idle` | inicial / "Recomeçar" | `{component.empty-state}`, CTA desabilitado, player desabilitado |
| `uploading` | XHR em progresso | `{component.bubble-loading}` + `{component.progress-bar}` determinada com % real |
| `pending` | `POST` respondeu `Pending` | bolha neutra "Na fila para transcrição" |
| `processing` | polling retornou `Processing` | `{component.bubble-loading}` indeterminada, palavra `Processing` |
| `completed` | polling retornou `Completed` | `{component.bubble-summary}` com `N / 500 caracteres` |
| `failed` | polling `Failed` ou erro HTTP no upload | `{component.bubble-error}` + "Tentar novamente" |
| `disabled` | `POST` respondeu `Disabled` | bolha neutra, chip neutro — não é erro |

## Contrato com a API

| Ação | Chamada | Resposta usada |
|------|---------|----------------|
| Enviar | `POST {base}/api/audios` (`multipart/form-data`, campo `file`) | 201 `AudioFileDto` (`id`, `summaryStatus`) · 400 validação · 422 não decodificável |
| Acompanhar | `GET {base}/api/audios/{id}/summary` a cada 2s | `status`, `summary`, `summaryLength`, `maxSummaryLength`, `language`, `error` |

Base URL: `NEXT_PUBLIC_API_BASE_URL`, padrão `http://localhost:5218`.
Polling para em qualquer fase terminal ou após 5 minutos.

## Riscos e decisões

- **`fetch` não reporta progresso de upload** → `XMLHttpRequest` no POST. O DESIGN.md proíbe
  porcentagem inventada, então essa é a única fonte legítima de `%`.
- **Transcrição não tem porcentagem** → barra indeterminada + palavra `Processing`.
- **CORS** é pré-requisito real: sem a política, todo request morre antes do handler. Entra como
  fatia própria, com teste de integração.
- **`Disabled` não é falha** → tratamento neutro (entrada nova em `docs/DESIGN.md` §7).
- **Player toca o arquivo local** (`URL.createObjectURL`), não o `.m4a` armazenado: funciona antes
  de qualquer round-trip e mantém a tela sem UI de download.

## Critérios de aceite

- `npm run test -- --run` e `npm run build` verdes em `web/`.
- Teste falha se o componente de carregamento não estiver na tela durante o upload.
- `dotnet test` continua verde e o gate de sandbox continua verde.
- Nenhum valor visual fora dos tokens do `docs/DESIGN.md`.
