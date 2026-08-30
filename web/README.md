# Prog7 · Audio Summary Studio (frontend)

Cliente web da [AudioApi](../README.md). Uma tela: envie um áudio, acompanhe o trabalho do
servidor e leia o resumo de até 500 caracteres — tudo na mesma conversa.

- **Stack**: Next.js (App Router) + TypeScript + Tailwind v4. Sem biblioteca de componentes, de
  estado ou de HTTP — React e a plataforma.
- **Paralelismo no cliente**: a validação pré-upload roda em um Web Worker dedicado; ambientes
  sem Worker usam o mesmo validador por um fallback assíncrono.
- **Design**: [`../docs/DESIGN.md`](../docs/DESIGN.md) é a fonte da verdade visual. Todo valor
  visual do código resolve para um token declarado em [`app/globals.css`](app/globals.css).
  Gap no design volta para o documento, nunca é improvisado no TSX.

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

- `__tests__/audio-validation.test.ts` — extensão, MIME, limite de 50 MB, arquivo vazio e magic
  bytes dos formatos aceitos, incluindo o runner paralelo e seu fallback.
- `__tests__/upload-validation-flow.test.tsx` — estado “validando”, bloqueio do envio inválido e
  apresentação de falhas do Worker.
- `__tests__/useProcessedAudios.test.tsx` — inclusão imediata de um áudio Pending aceito pelo POST
  enquanto a lista é reconciliada com o servidor.
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
  audioValidation.ts regras puras de validação de arquivos de áudio
  audioValidationClient.ts execução em Worker e fallback assíncrono
  useTranscription.ts máquina de fases (upload + polling)
  types.ts           espelhos TS dos DTOs em C#
workers/
  audioValidation.worker.ts entrada do Worker de validação pré-upload
```

## Validação antes do upload

Selecionar ou arrastar um arquivo inicia a validação antes de qualquer `POST /api/audios`. A
confirmação fica desabilitada até o resultado. São verificados extensão, MIME type correspondente,
arquivo não vazio, tamanho máximo de 50 MB e assinatura do conteúdo para MP3, WAV, OGG, FLAC, M4A,
AAC e WEBM. Arquivos rejeitados permanecem apenas no cliente e a interface informa o motivo.

O atributo `accept` da entrada é apenas uma ajuda para o seletor de arquivos; a decisão é feita
pelo validador após a seleção e também vale para drag-and-drop. A validação da API permanece como
segunda camada de proteção.

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
