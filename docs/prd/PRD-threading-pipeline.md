# PRD — Pipeline de processamento em background (compressão + sumarização)

Semana 4 / Atividade #1 do projeto final: **aplicar threading no servidor para reduzir o tempo de
resposta de uma solicitação de áudio**, e mostrar o resumo de cada áudio processado no cliente.

## Problema

O `POST /api/audios` de hoje é síncrono no que importa:

```
POST /api/audios
  ├ AudioFileValidator      rápido
  ├ FfmpegAudioCompressor   ◄── transcodifica o arquivo INTEIRO, dentro da requisição
  ├ LocalFileStore          grava o .m4a
  ├ AppDbContext            grava a linha
  ├ ISummaryQueue           enfileira (já é background — semana 3)
  └ 201 Created
```

A semana 3 tirou a **sumarização** da thread da requisição (`Channel<Guid>` +
`BackgroundService` + `SemaphoreSlim`). A **compressão** continuou dentro dela, com o argumento
— correto na época — de que 160ms para um áudio de 11s não incomodava
(`docs/week2-analysis.md`).

Esse argumento não escala. `ffmpeg` custa aproximadamente tempo linear no tamanho da entrada:
160ms para 352 KB. O limite de upload é **50 MB** (≈ 1 hora de MP3 a 128kbps), o que coloca a
transcodificação na casa das **dezenas de segundos** dentro da requisição — somados ao tempo de
subida dos 50 MB. O cliente fica com uma conexão aberta esperando trabalho de CPU que não tem
nada a ver com receber o arquivo.

Além disso, **nada limita quantos `ffmpeg` rodam ao mesmo tempo**: N uploads simultâneos =
N processos `ffmpeg` competindo pelos mesmos núcleos, cada um mais lento que se tivessem sido
enfileirados.

No cliente, a tela guarda **uma** sessão por vez e descarta o áudio anterior ao recomeçar. O
endpoint `GET /api/audios` existe desde a semana 1 e nunca foi consumido: não há como ver o
resumo dos áudios já processados.

## Objetivo

1. O `POST /api/audios` responde em ~tempo de recepção do arquivo, sem esperar `ffmpeg`.
2. Compressão e sumarização rodam **fora da thread da requisição**, cada uma com seu limite de
   concorrência explícito.
3. O cliente lista os áudios processados e **mostra o resumo de cada um**.
4. A suíte continua verde e o fluxo de upload continua correto de ponta a ponta.

## Não-objetivos

- Persistir a fila / reprocessar `Pending` órfão no startup (mesmo gatilho documentado na
  semana 3: só importa quando perder um job passar a doer).
- Retentativa com backoff.
- Fila distribuída / múltiplas instâncias da API.
- Trocar o worker Whisper, o modelo, ou o formato de saída (`.m4a` AAC continua).
- Qualquer mudança visual que não esteja em `docs/DESIGN.md`.

## Fluxo alvo

```
POST /api/audios
  ├ AudioFileValidator            valida nome/content-type/tamanho     → 400 se inválido
  ├ LocalFileStore.SaveAsync      grava os bytes ORIGINais (.wav/.mp3/…)
  ├ AppDbContext                  linha AudioFile
  │                                 ProcessingStatus = Pending
  │                                 SummaryStatus    = Pending | Disabled
  ├ IProcessingQueue.TryEnqueue   enfileira só o Guid
  └ 201 Created ─────────────────────────────────────────► resposta sai aqui

      ⋮ thread de background #1, escopo de DI próprio

AudioProcessingBackgroundService          (SemaphoreSlim: Processing:MaxConcurrency)
  ├ ProcessingStatus = Processing
  ├ IFileStore.OpenReadAsync               relê os bytes originais
  ├ FfmpegAudioCompressor                  transcodifica para AAC
  ├ IFileStore.SaveAsync                   grava o .m4a
  ├ IFileStore.DeleteAsync                 apaga o original
  ├ StoredFileName/ContentType/SizeBytes   passam a apontar para o .m4a
  ├ ProcessingStatus = Completed
  └ ISummaryQueue.TryEnqueue               ─┐
                                            │
      ⋮ thread de background #2             │

AudioSummaryBackgroundService  ◄────────────┘   (inalterado — SemaphoreSlim: Summarization:MaxConcurrency)
  └ SummaryStatus = Processing → Completed | Failed
```

Falha de decodificação deixa de ser um **422 na requisição** e passa a ser
`ProcessingStatus = Failed` + `ProcessingError` na linha — exatamente o mesmo tratamento que a
semana 3 deu para falha de sumarização, e pela mesma razão: o trabalho não acontece mais dentro
da requisição, então a requisição não pode reportar o resultado dele.

## Decisões de projeto

| Decisão | Alternativa rejeitada | Por quê |
|---------|----------------------|---------|
| Duas filas (`IProcessingQueue`, `ISummaryQueue`) | Uma fila com um tipo de job | Cada etapa tem seu próprio limite de concorrência: compressão é CPU **local** (limite = núcleos), sumarização é rede + VPS de 4 vCPUs (limite = 1). Uma fila só forçaria um limite comum e errado para as duas |
| `Channel<Guid>` limitado, `TryEnqueue` | `await WriteAsync` | Esperar por vaga devolveria a lentidão para dentro da requisição — é a razão de a mudança existir |
| Guardar os bytes **originais** e substituir pelo `.m4a` | Guardar em memória até comprimir | 50 MB por upload em memória, multiplicado pela fila, é o mesmo estouro que a fila limitada existe para evitar. Disco é o lugar certo |
| `SemaphoreSlim(ProcessorCount)` na compressão | Concorrência ilimitada | `ffmpeg` é CPU-bound: mais processos que núcleos deixa **todos** mais lentos e ainda compete com o thread pool que atende HTTP |
| `SemaphoreSlim(1)` em volta de `SaveChangesAsync` nos serviços de background | Nada / retry em `SQLITE_BUSY` | SQLite admite **um único escritor**. Com N compressores + 1 sumarizador gravando concorrentemente, `database is locked` deixa de ser hipótese. Serializar a escrita é mais barato e determinístico que descobrir o erro e tentar de novo |
| Escopo de DI por job | Reusar o contexto da requisição | `AppDbContext` é `scoped` e não é thread-safe; o escopo da requisição já morreu |
| `BackgroundService` | `Task.Run` / `new Thread` | Ciclo de vida do host, `stoppingToken`, shutdown limpo — igual à semana 3 |
| Cliente lista via `GET /api/audios` | Lista só o que esta aba enviou | O endpoint já existe e devolve tudo do servidor, mais novo primeiro. Estado no servidor sobrevive ao reload |

## Requisitos

### Servidor

- **R1** — `POST /api/audios` não executa `ffmpeg`. Responde **201** assim que os bytes originais
  estão gravados e a linha existe.
- **R2** — `ProcessingStatus` (`Pending | Processing | Completed | Failed`) persistido na linha
  `AudioFile`, com `ProcessingError` e `ProcessingUpdatedAtUtc`.
- **R3** — `AudioProcessingBackgroundService` consome a fila de compressão, transcodifica,
  substitui o arquivo armazenado pelo `.m4a`, atualiza
  `StoredFileName`/`ContentType`/`SizeBytes` e marca `Completed`.
- **R4** — Concluída a compressão, e só então, o job de sumarização é enfileirado. Compressão
  `Failed` ⇒ `SummaryStatus = Failed` com o motivo (o áudio nunca terá `.m4a` para resumir).
- **R5** — Concorrência de compressão limitada por `Processing:MaxConcurrency`
  (padrão: número de processadores, mínimo 1). Fila limitada por `Processing:QueueCapacity`
  (padrão 100); fila cheia ⇒ `ProcessingStatus = Failed`, upload continua **201**.
- **R6** — Escritas no banco vindas dos serviços de background são serializadas
  (SQLite tem um escritor só).
- **R7** — Uma falha de job nunca derruba o loop nem o host; ela é logada e gravada na linha.
- **R8** — `GET /api/audios/{id}` e `GET /api/audios/{id}/summary` expõem `processingStatus`
  (e o erro, quando houver), para o cliente distinguir "comprimindo" de "resumindo".
- **R9** — `GET /api/audios/{id}/download` durante a compressão devolve os bytes originais
  (o registro existe e o arquivo existe); nunca 500.

### Cliente

- **R10** — A tela lista os áudios processados (`GET /api/audios`) e **cada item mostra o resumo
  do áudio**, com o nome do arquivo, a data e o estado.
- **R11** — Item sem resumo mostra o motivo em vez de um vazio: comprimindo, resumindo, falhou
  (com a mensagem), ou sumarização desabilitada. `Disabled` é neutro, nunca vermelho
  (`docs/DESIGN.md` §8).
- **R12** — A lista se atualiza sozinha enquanto houver item não-terminal, e para de atualizar
  quando todos estiverem terminais.
- **R13** — Todo valor visual resolve para um token de `docs/DESIGN.md`. Nenhum hex, nenhum px
  cru, nenhum estado não documentado.

### Qualidade

- **R14** — A suíte anterior continua verde. Os dois testes que codificavam a compressão
  **síncrona** (`Post_Wav_Returns201_AndAudioIsStoredCompressedAsAac`,
  `Post_AudioContentTypeButNotDecodable_Returns422`) passam a esperar o pipeline: mesmo
  comportamento observável (vira `.m4a`; lixo é rejeitado), agora depois da resposta em vez de
  dentro dela. Nenhum outro teste muda.
- **R15** — Nenhuma dependência nova. `System.Threading.Channels`, `SemaphoreSlim`,
  `BackgroundService` são BCL/ASP.NET Core.
- **R16** — O gate do sandbox (`unit-tests` + `integration`) fica verde, sem rede.

## Medição (o "perceptível" tem que ser medido)

O MR precisa mostrar número, não adjetivo. `docs/week4-threading-pipeline.md` registra, para o
mesmo arquivo, o tempo de resposta do `POST /api/audios` antes (com `ffmpeg` dentro) e depois
(com `ffmpeg` no background), a partir dos logs da própria aplicação.

## Atenção ao banco existente

O schema é criado com `EnsureCreated()` e o projeto não usa migrations. As colunas novas
(`ProcessingStatus`, `ProcessingError`, `ProcessingUpdatedAtUtc`) **não** são adicionadas a um
`data/audios.db` que já existe. Apague o arquivo (`rm src/AudioApi/data/audios.db`) ou o volume
`audio-data` do compose antes de subir.
