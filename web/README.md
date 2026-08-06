# Prog7 · Audio Summary Studio (frontend)

Cliente web da [AudioApi](../README.md). Uma tela: envie um áudio, acompanhe o trabalho do
servidor e leia o resumo de até 500 caracteres — tudo na mesma conversa.

- **Stack**: Next.js (App Router) + TypeScript + Tailwind v4. Sem biblioteca de componentes, de
  estado ou de HTTP — React e a plataforma.
- **Design**: [`../docs/DESIGN.md`](../docs/DESIGN.md) é a fonte da verdade visual. Todo valor
  visual do código resolve para um token declarado em [`app/globals.css`](app/globals.css).
  Gap no design volta para o documento, nunca é improvisado no TSX.
- **Contexto do agente**: [`../.claude/contexts/frontend/CONTEXT.md`](../.claude/contexts/frontend/CONTEXT.md).

## Rodar

A API precisa estar de pé antes (porta 5218):

```bash
# na raiz do repositório
dotnet run --project src/AudioApi
```

Depois, em outro terminal:

```bash
npm install
npm run dev     # http://localhost:3000
```

A origem `http://localhost:3000` já está liberada na seção `Cors` do `appsettings.json` da API.
Para apontar para outra instância:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run dev
```

| Variável | Padrão | Significado |
|----------|--------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:5218` | Base URL da AudioApi |

## Testes

```bash
npm run test:run   # Vitest + React Testing Library, sem watch
npm run test       # modo watch
npm run typecheck  # tsc --noEmit
npm run build
```

Cobertura relevante:

- `__tests__/loading-state.test.tsx` — **requisito do MR**: o componente de carregamento aparece
  enquanto o arquivo está sendo enviado e some quando o upload resolve.
- `__tests__/tokens.test.ts` — trava os contrastes citados nos comentários dos tokens; um número
  desatualizado vira teste vermelho, não comentário mentiroso.
- `__tests__/api.test.ts`, `__tests__/useTranscription.test.tsx` — upload com progresso real,
  polling e todas as transições de fase.
- `__tests__/ui-primitives.test.tsx` — primitivos de UI e suas variantes.

## Estrutura

```
app/
  layout.tsx      fontes Inter + JetBrains Mono
  globals.css     TODOS os tokens do DESIGN.md (@theme do Tailwind v4)
  page.tsx        composição da tela
components/
  ui/             primitivos, um arquivo por família {component.x}
  transcription/  composições da tela (rail, topbar, thread, painel, player, modais)
lib/
  api.ts             único módulo que fala HTTP com a AudioApi
  useTranscription.ts máquina de fases (upload + polling)
  types.ts           espelhos TS dos DTOs em C#
```

## Verificação manual (ponta a ponta)

1. Suba a API e o front (comandos acima).
2. Escolha um `.wav`/`.mp3` no painel da direita e clique em **Transcrever**.
3. Durante o upload: barra de progresso com a porcentagem real dos bytes enviados.
4. Depois do `201 Created`: a thread mostra `Pending` → `Processing` (polling a cada 2s).
5. Com o worker Whisper ligado (veja
   [`../worker/audio-summary-worker/README.md`](../worker/audio-summary-worker/README.md)), a
   última mensagem é o resumo com `N / 500 caracteres`.
   Com `Summarization:Enabled = false` (padrão), a tela mostra **Resumo desativado** — estado
   neutro, não é erro.
