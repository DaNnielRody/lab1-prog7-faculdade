# Tickets — Pipeline de processamento em background

Fatias verticais de [PRD-threading-pipeline.md](PRD-threading-pipeline.md). Cada fatia é
entregável sozinha (modelo → serviço → endpoint → teste) e deixa a suíte verde.

---

## T1 — Tirar a compressão da thread da requisição

**Requisitos**: R1, R2, R3, R4, R5, R7, R9, R14
**blocking**: —

O `POST /api/audios` para de rodar `ffmpeg`. Grava os bytes originais, cria a linha com
`ProcessingStatus = Pending`, enfileira o `Guid` e responde **201**. Um `BackgroundService` novo
comprime, substitui o arquivo armazenado pelo `.m4a` e só então enfileira a sumarização.

**Arquivos**
- `src/AudioApi/Models/ProcessingStatus.cs` *(novo)* — `Pending | Processing | Completed | Failed`,
  `JsonStringEnumConverter`, igual a `SummaryStatus`.
- `src/AudioApi/Models/AudioFile.cs` — `+ ProcessingStatus`, `+ ProcessingError`,
  `+ ProcessingUpdatedAtUtc`.
- `src/AudioApi/Data/AppDbContext.cs` — `ProcessingStatus` como string obrigatória
  `HasMaxLength(16)`, `ProcessingError` `HasMaxLength(1024)`.
- `src/AudioApi/Options/ProcessingOptions.cs` *(novo)* — `SectionName = "Processing"`,
  `MaxConcurrency` (padrão `Environment.ProcessorCount`, mínimo 1), `QueueCapacity` (padrão 100).
- `src/AudioApi/Processing/IProcessingQueue.cs`, `ProcessingQueue.cs` *(novos)* — `Channel<Guid>`
  limitado, `FullMode = DropWrite`, `SingleReader = true`, `SingleWriter = false`. Mesma forma que
  `SummaryQueue`.
- `src/AudioApi/Processing/AudioProcessingBackgroundService.cs` *(novo)* — consumidor:
  `SemaphoreSlim` de concorrência, escopo de DI por job, `try/catch` por job, `Task.WhenAll` no
  shutdown. Mesma forma que `AudioSummaryBackgroundService`.
- `src/AudioApi/Storage/IFileStore.cs`, `LocalFileStore.cs` — `+ DeleteAsync(storedFileName, ct)`
  para apagar o original depois de comprimir.
- `src/AudioApi/Endpoints/AudioEndpoints.cs` — `UploadAsync` perde `IAudioCompressor` e o ramo 422;
  ganha `IProcessingQueue`.
- `src/AudioApi/Program.cs` — bind de `ProcessingOptions`, `AddSingleton<IProcessingQueue>`,
  `AddHostedService<AudioProcessingBackgroundService>`.
- `src/AudioApi/appsettings.json` — seção `Processing`.

**Regras**
- Só o `Guid` atravessa a fila. Nada de `Stream`, `DbContext` ou `HttpContext`.
- Compressão `Completed` ⇒ `ISummaryQueue.TryEnqueue`, e só aí. Compressão `Failed` ⇒
  `SummaryStatus = Failed` com o motivo (nunca haverá `.m4a`).
- `InvalidOperationException` do compressor ⇒ `ProcessingStatus = Failed` + `ProcessingError`.
  Nunca derruba o loop.
- Fila cheia ⇒ `ProcessingStatus = Failed` com o motivo, upload continua **201**.
- Extensão original: `Path.GetExtension(file.FileName)`, minúscula; vazia ⇒ `.bin`.
- **Banco existente**: as três colunas novas não são adicionadas a um `data/audios.db` que já
  existe (`EnsureCreated()`, sem migrations). Sem apagar o arquivo — e o volume `audio-data` do
  compose — o app quebra com `SQLite Error 1: 'no such column: a.ProcessingStatus'`. O gate do
  sandbox sobe container limpo, então isso só atinge humanos, e só depois do merge: precisa estar
  no corpo do PR.

**Testes**
- `tests/AudioApi.Tests/AudioProcessingIntegrationTests.cs` *(novo)*
  - upload devolve 201 com `ProcessingStatus = Pending` e `StoredFileName` **não** `.m4a`;
  - polling até `Completed` ⇒ `StoredFileName` `.m4a`, `ContentType` `audio/mp4`, download com
    `ftyp` no header e `SizeBytes` batendo com os bytes baixados;
  - lixo com content-type de áudio ⇒ upload **201**, depois `ProcessingStatus = Failed` com
    `ProcessingError`, e `SummaryStatus = Failed`;
  - `GET /{id}/download` durante `Pending` devolve 200 (os bytes originais), nunca 500;
  - N uploads concorrentes terminam todos `Completed` (prova de que a fila e o semáforo seguram
    a carga).
- `tests/AudioApi.Tests/AudioApiIntegrationTests.cs` — os dois testes que codificavam a compressão
  síncrona passam a esperar o pipeline. Mesmo comportamento observável, agora depois da resposta.
  **Nenhum outro teste muda.**

---

## T2 — Serializar a escrita no banco vinda do background

**Requisitos**: R6
**blocking**: T1

SQLite aceita **um escritor por vez**. Com `Processing:MaxConcurrency` > 1, vários compressores e
o sumarizador gravam concorrentemente e `SQLite Error 5: 'database is locked'` deixa de ser
hipótese. As gravações dos serviços de background passam por um gate compartilhado.

**Arquivos**
- `src/AudioApi/Data/IDbWriteGate.cs`, `DbWriteGate.cs` *(novos)* — singleton envolvendo um
  `SemaphoreSlim(1, 1)`; expõe `Task<T> WriteAsync<T>(Func<Task<T>> write, CancellationToken ct)`
  ou equivalente, com `finally { Release(); }`.
- `src/AudioApi/Processing/AudioProcessingBackgroundService.cs`,
  `src/AudioApi/Summarization/AudioSummaryBackgroundService.cs` — todo `SaveChangesAsync` de job
  passa pelo gate.
- `src/AudioApi/Program.cs` — registro do singleton.

**Regras**
- O gate cobre **só** a escrita, nunca a compressão nem a chamada HTTP ao worker — segurar o
  semáforo durante o trabalho pesado anularia a concorrência que a fatia T1 acabou de criar.
- O caminho da requisição (`UploadAsync`) **não** usa o gate: um único `SaveChangesAsync` por
  requisição, e o gate lá dentro colocaria a espera de volta na thread da requisição.

**Testes**
- Coberto pelo teste de N uploads concorrentes de T1: sem o gate ele fica intermitente com
  `database is locked`; com o gate, determinístico.

---

## T3 — Expor `processingStatus` na API

**Requisitos**: R8
**blocking**: T1

O cliente precisa distinguir "comprimindo" de "resumindo" — hoje os dois apareceriam como
`Pending`.

**Arquivos**
- `src/AudioApi/Dtos/AudioFileDto.cs` — `+ ProcessingStatus`, `+ ProcessingError`,
  `+ ProcessingUpdatedAtUtc`.
- `src/AudioApi/Dtos/AudioSummaryDto.cs` — `+ ProcessingStatus`, `+ ProcessingError`, para o
  cliente poder continuar com **um** endpoint de polling.

**Testes**
- Assertivas nos testes de integração de T1: os dois DTOs carregam o estado de processamento em
  cada transição.

---

## T4 — Cliente: lista de áudios processados, cada um com seu resumo

> ⚠️ **Esta fatia foi entregue como escrita e depois revertida.** O `ProcessedList` abaixo foi
> implementado, revisado e removido: a tela é um chat, e a página Screens do Figma
> (`7HoYbh5Peur8sdpSodTyKC`, node `0:1`) não contém lista nenhuma — o Chat body (`5:47`) só tem
> mensagens. O requisito é atendido por **uma mensagem por áudio na conversa**
> (`Thread.renderProcessed`). O ticket fica como está, sem reescrita, porque o erro foi
> especificar um componente sem conferir a fonte do design, e apagar o rastro esconderia isso.
> Ver `docs/DESIGN.md` §11 e `docs/week4-threading-pipeline.md`.

**Requisitos**: R10, R11, R12, R13
**blocking**: T3

**Arquivos**
- `web/lib/types.ts` — `ProcessingStatus`, campos novos em `AudioFileDto`/`AudioSummaryDto`.
- `web/lib/api.ts` — `listAudios(signal?)` → `GET /api/audios`. Único módulo que fala HTTP.
- `web/lib/useProcessedAudios.ts` *(novo)* — carrega a lista, recarrega quando a sessão atual chega
  a um estado terminal, e faz polling **só enquanto houver item não-terminal**; para sozinho
  quando todos estiverem terminais e no unmount.
- `web/components/transcription/ProcessedList.tsx` *(novo)* — um item por áudio: nome, data,
  chip de estado e **o resumo**. Sem resumo ⇒ o motivo (comprimindo / resumindo / falhou com a
  mensagem / desabilitado), nunca um vazio.
- `web/app/page.tsx` — monta a lista.

**Regras**
- Todo valor visual resolve para um token de `docs/DESIGN.md`. Lacuna do documento volta para o
  documento (`df-design`), nunca improvisada em TSX.
- `Disabled` renderiza neutro, nunca vermelho (§8).
- Sem timestamps falsos e sem turnos de fala — a API devolve **um** resumo (§8 Don't 4).

**Testes**
- `web/__tests__/processed-list.test.tsx` *(novo)* — item `Completed` mostra o texto do resumo;
  item comprimindo/resumindo mostra o estado, não um vazio; item `Failed` mostra a mensagem;
  item `Disabled` renderiza neutro.
- `web/__tests__/api.test.ts` — `listAudios` acerta a URL e propaga o erro como `ApiError`.

---

## T5 — Documentar e medir

**Requisitos**: medição do PRD
**blocking**: T1, T4

**Arquivos**
- `docs/week4-threading-pipeline.md` *(novo)* — o que mudou, por que agora, as primitivas de
  sincronização escolhidas e **os números** do `POST /api/audios` antes e depois, tirados dos logs
  da aplicação.
- `README.md` — a seção de fluxo passa a refletir o pipeline.
- `.claude/contexts/{api,compression,summarization,storage,persistence,frontend}/CONTEXT.md` — a
  escrita de volta obrigatória do CONTEXT-MAP.
