# Prog7 — Audio Upload API

API em **ASP.NET Core (.NET 10)** que recebe arquivos de áudio, armazena os bytes em um
**File Store** e registra em um banco de dados o **UUID** do arquivo junto com a **URL**
do file store e os demais metadados.

## Entregáveis

| Entregável | Onde |
| --- | --- |
| **Documento de arquitetura** — escopo, objetivos, caso de uso, componentes e diagramas | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **Diagrama do pipeline do sistema** | [`docs/ARCHITECTURE.md` §5](docs/ARCHITECTURE.md#5-pipeline-do-sistema) |
| **Servidor API** que processa e armazena áudio | [`src/AudioApi/`](src/AudioApi) |
| **Cliente Web** que envia áudio para a API | [`web/`](web) |
| **Documentação Swagger/OpenAPI** | `http://localhost:5218/swagger` (JSON em `/swagger/v1/swagger.json`) |
| **Arquivo `.http`** para testar a API | [`src/AudioApi/AudioApi.http`](src/AudioApi/AudioApi.http) |
| **Slides de apresentação** | [`docs/presentation.html`](docs/presentation.html) — abra no navegador |
| **Benchmark sequencial vs. otimizado e análise** | [`docs/activity-1-sequential-vs-parallel-benchmark.md`](docs/activity-1-sequential-vs-parallel-benchmark.md) |
| **Filtro de áudio no servidor e prévia no cliente** | [`docs/week7-audio-filter-and-preview.md`](docs/week7-audio-filter-and-preview.md) |
| **Descrição pronta do MR** | [`docs/mr-activity-1.md`](docs/mr-activity-1.md) |
| **Instruções de configuração e execução** | este README, seções abaixo |

## O que o projeto faz

- Recebe um arquivo de áudio via `multipart/form-data`.
- Valida se o upload é realmente um áudio (por content-type `audio/*` **ou** por extensão).
- Gera um `Guid` (UUID) para o arquivo, grava os bytes no file store e responde **201** quando o
  job é admitido — **sem rodar `ffmpeg`**. Fila saturada responde **503** sem persistir o upload.
- Persiste um registro no banco com: `Id`, `OriginalFileName`, `StoredFileName`, `Url`,
  `ContentType`, `SizeBytes`, `CreatedAtUtc`, os campos de processamento (`ProcessingStatus`,
  `ProcessingError`, `ProcessingUpdatedAtUtc`) e os de resumo (`Summary`, `SummaryStatus`,
  `SummaryLanguage`, `SummaryError`, `SummaryUpdatedAtUtc`) e os do filtro (`FilterStatus`,
  `FilterError`, `FilterUpdatedAtUtc`, `FilteredStoredFileName`, `FilteredContentType`,
  `FilteredSizeBytes`, `FilteredUrl`).
- **Comprime o áudio para AAC** (`.m4a`, via `ffmpeg`), **deriva uma versão filtrada** com realce
  de voz e a salva como arquivo extra do mesmo id, e **extrai um resumo do áudio
  (≤ 500 caracteres)** com um modelo de IA leve local (Whisper `tiny`) — tudo em **workers em
  background**, fora da thread da requisição.
- Expõe endpoints para consultar os metadados, baixar o arquivo, baixar a versão filtrada,
  consultar o resumo e listar tudo.

### Pipeline de processamento (compressão + resumo, em background)

O `POST /api/audios` **não roda `ffmpeg`**. Ele valida, grava os bytes originais, cria a linha com
`ProcessingStatus: "Pending"` e responde **201** — para um WAV de 42 MB, em **~0,2s** em vez dos
**~2,9s** de antes (≈ 14x). A medição está em
[`docs/week4-threading-pipeline.md`](docs/week4-threading-pipeline.md).

Duas filas limitadas (`Channel<Guid>`) e dois `BackgroundService` fazem o resto:

```
POST → 201 (Pending) | 503 (sem persistência por overload)
   └→ fila de compressão  → ffmpeg → .m4a substitui o original → Completed
        ├→ filtro (mesmo job) → ffmpeg -af → {id}.filtered.m4a → FilterStatus Completed
        └→ fila de resumo → Whisper → Completed | Failed
```

A compressão consome sua fila com `Parallel.ForEachAsync`, limitado por
`MaxDegreeOfParallelism = Processing:MaxConcurrency` (padrão:
`Environment.ProcessorCount`). A sumarização continua usando `SemaphoreSlim`, porque disputa a
**VPS remota** de 4 vCPUs (padrão: 1). Como os dois workers gravam no mesmo SQLite — que aceita
**um escritor por vez** — as escritas de background passam por um `DbWriteGate`
(`SemaphoreSlim(1,1)`).

Todo áudio é transcodificado para **AAC** (container `.m4a`, 128 kbps por padrão) por
`AudioApi.Compression.FfmpegAudioCompressor`, e o original é apagado assim que a linha do `.m4a`
é commitada — no fim, um arquivo por áudio. O tempo de compressão é medido e logado
(`Áudio comprimido para AAC em {ms}ms ...`).

Se o arquivo não puder ser decodificado, a API **não** responde 422: a requisição não decodifica
mais nada, então a falha aparece como `ProcessingStatus: "Failed"` + `ProcessingError` na linha,
e o upload continua **201**. O `400` de validação (nome/content-type/tamanho) continua dentro da
requisição, porque não decodifica nada.

As filas bounded usam `FullMode=Wait` e uma reserva imediata de capacidade. Quando não há vaga,
a API responde 503 antes de criar arquivo ou linha. Não se usa `DropWrite`, pois o runtime retorna
`true` mesmo quando descarta o novo item. A reserva é feita antes do file store/SQLite e publicada
ao consumidor somente depois do commit; falha de persistência libera a vaga e apaga apenas o
arquivo do novo GUID. No shutdown o writer é
fechado, novos produtores são rejeitados e jobs interrompidos voltam a `Pending`; no startup, o
worker reenfileira `Pending`/`Processing` recuperáveis e terminaliza como `Failed` o que exceder a
capacidade disponível.

A política de exceções do worker é explícita:

| Classe real | Política |
| --- | --- |
| `OperationCanceledException` com token do host cancelado | não é falha do áudio; volta a `Pending`, propaga o cancelamento e é recuperado no próximo start |
| `AudioCompressionException` (ffmpeg terminou com código não zero) | falha permanente do item; marca somente o áudio como `Failed` e continua |
| `FileNotFoundException` para o arquivo específico | falha conhecida do item; mensagem pública sem caminho e continuação dos próximos jobs |
| demais `IOException`/`UnauthorizedAccessException`, `Win32Exception`, `DbUpdateException`/`SqliteException` e tipos não classificados | falha potencialmente sistêmica/bug; log `Critical` e exceção fatal sanitizados, com terminalização best-effort |

Não há retry automático: áudio inválido é permanente, e o projeto não possui um critério seguro de
idempotência/transitoriedade para filesystem ou SQLite. O comparativo progressivo e o CSV bruto
estão em [`docs/week5-parallel-users-before-after.md`](docs/week5-parallel-users-before-after.md).

Histórico do raciocínio: [`docs/week2-analysis.md`](docs/week2-analysis.md) (por que ainda não),
[`docs/week3-threading-explanation.md`](docs/week3-threading-explanation.md) (o resumo sai da
requisição), [`docs/week4-threading-pipeline.md`](docs/week4-threading-pipeline.md) (a compressão
também sai, e a medição),
[`docs/week6-frontend-parallel-validation.md`](docs/week6-frontend-parallel-validation.md) (o
paralelismo no cliente, validando o áudio antes do upload) e
[`docs/week7-audio-filter-and-preview.md`](docs/week7-audio-filter-and-preview.md) (o filtro
derivado no servidor e a prévia que toca os dois áudios).

O comparativo exigido pela Atividade #1 está em
[`docs/activity-1-sequential-vs-parallel-benchmark.md`](docs/activity-1-sequential-vs-parallel-benchmark.md):
ele documenta a versão sequencial da API e do cliente, os CSVs brutos, os gráficos, as métricas,
as porcentagens de economia e as limitações. O estado otimizado/paralelo continua sendo o padrão;
`Processing:ExecutionMode=Sequential` e `NEXT_PUBLIC_AUDIO_VALIDATION_MODE=sequential` servem
como baseline reproduzível.

### Resumo de áudio (Whisper local, ≤ 500 caracteres)

Depois de armazenado, o áudio é transcrito por **Whisper `tiny`**
([faster-whisper](https://github.com/SYSTRAN/faster-whisper), int8, CPU) e reduzido a um **resumo de
no máximo 500 caracteres**. O modelo roda **local**, em um worker HTTP separado
(`worker/audio-summary-worker/`) — nenhuma API paga de IA é usada.

O trabalho **não acontece durante o `POST`**: o upload responde **201** com
`summaryStatus: "Pending"`, e o job de resumo é enfileirado pelo worker de compressão assim que o
`.m4a` existe. Um `BackgroundService` consome essa fila, chama o worker Whisper e grava o
resultado. O cliente acompanha via `GET /api/audios/{id}/summary`
(`Pending` → `Processing` → `Completed` | `Failed`), que também devolve o `processingStatus`.

Isso é o oposto da conclusão da semana 2, e de propósito: a compressão custou 160ms para um arquivo
onde a sumarização custou 1435ms (~9x), e a transcrição escala com a **duração** do áudio (~10x
tempo real), então um upload de 50 MB levaria minutos. O raciocínio completo — primitivas
escolhidas, alternativas rejeitadas e o que ficou de fora — está em
[`docs/week3-threading-explanation.md`](docs/week3-threading-explanation.md).

O limite de 500 caracteres é garantido em três camadas independentes: no worker, na API
(`SummaryTruncator.Clamp`, coberto por testes) e na coluna do banco (`HasMaxLength(500)`).

**No Docker Compose a sumarização já vem ligada**: `docker compose up --build` sobe a API e o
worker juntos, e o worker baixa o modelo sozinho na primeira execução.

Rodando pelo `dotnet run`, ela vem **desligada** (`Summarization:Enabled = false`) para que
`dotnet test` e o CI nunca dependam de rede nem de um worker de pé. Para ligar nesse modo, veja
[`worker/audio-summary-worker/README.md`](worker/audio-summary-worker/README.md).

### Visão de arquitetura

- **Minimal APIs** agrupadas em `Endpoints/AudioEndpoints.cs`.
- **`IFileStore`** — abstração de armazenamento binário. A implementação padrão
  `LocalFileStore` grava em um diretório local configurável e produz uma URL resolvível
  apontando para o endpoint de download (`{baseUrl}/api/audios/{id}/download`). O contrato
  foi desenhado para que um futuro `S3FileStore` / `AzureBlobFileStore` possa substituí-la
  sem alterar os endpoints.
- **EF Core + SQLite** (`AppDbContext`, entidade `AudioFile`). O banco é criado
  automaticamente no primeiro start via `EnsureCreated()` — nenhum passo manual é necessário.
- **ProblemDetails** para erros, **Swagger/OpenAPI** em Development e endpoint **`/health`**.
- Os diretórios de runtime (`filestore/` e `data/`) são criados automaticamente e estão no
  `.gitignore`.

### Endpoints

| Método | Rota                          | Descrição                                        |
|--------|-------------------------------|--------------------------------------------------|
| POST   | `/api/audios`                 | Envia um áudio. Retorna **201 + Location** se admitido ou **503** se a fila estiver saturada. |
| GET    | `/api/audios/{id}`            | Retorna os metadados do registro (404 se não existir). |
| GET    | `/api/audios/{id}/download`   | Faz o streaming dos bytes do arquivo — o original enquanto `ProcessingStatus` for `Pending`/`Processing`, o `.m4a` depois (404 se não existir). |
| GET    | `/api/audios/{id}/summary`    | Retorna o resumo (≤ 500 caracteres) e o estado da sumarização (404 se não existir). |
| GET    | `/api/audios`                 | Lista todos os registros.                        |
| GET    | `/health`                     | Verificação de saúde.                            |

### Frontend (`web/`)

Aplicação **Next.js (App Router) + TypeScript + Tailwind v4** que consome esta API: envia o áudio,
mostra o estado de carregamento durante o upload e exibe o resumo (ou o erro) na mesma tela.

A tela é uma **conversa**, e cada áudio que o servidor já processou (`GET /api/audios`) aparece
nela como **uma mensagem, mostrando o resumo daquele áudio** — as 10 mais recentes, antes da
sessão atual. Quando ainda não há resumo, a mensagem diz o motivo (comprimindo, falhou com a
mensagem do servidor, aguardando, ou resumo desativado); nenhum estado renderiza corpo vazio.
O polling roda só enquanto houver áudio não-terminal e para sozinho quando todos chegam a um
estado final.

Um novo envio entra na lista **assim que o `POST` é aceito** — o DTO devolvido pela API é mostrado
já em `Pending`/`Processing` e depois reconciliado com o `GET`, então a conversa nunca fica um ciclo
de polling atrás do que o usuário acabou de enviar.

**A validação acontece antes do upload, em paralelo.** Selecionar ou arrastar um arquivo dispara um
**Web Worker** dedicado que confere extensão, MIME type correspondente, arquivo não vazio, teto de
50 MB e a **assinatura do conteúdo** (magic bytes) dos sete formatos aceitos. Enquanto a validação
roda o envio fica bloqueado; se ela reprovar, o arquivo não sai do navegador e a interface mostra o
motivo. Ambientes sem `Worker` usam o mesmo validador por um fallback assíncrono. A validação da API
continua valendo como segunda camada — o cliente não substitui o servidor, só evita subir 50 MB para
receber um `400`. Detalhes e decisões em
[`docs/week6-frontend-parallel-validation.md`](docs/week6-frontend-parallel-validation.md).

**Cada áudio já processado tem uma barra de prévia.** Ela toca o áudio original — o que
`GET /api/audios/{id}/download` devolve — e alterna para o **áudio extra com filtros** que o
servidor derivou, servido por `GET /api/audios/{id}/download/filtered`. A faixa filtrada só fica
disponível quando o servidor concluiu o filtro; enquanto ele está pendente, ou se falhou, a opção
aparece desabilitada com o motivo visível em vez de virar um controle morto. Detalhes e decisões em
[`docs/week7-audio-filter-and-preview.md`](docs/week7-audio-filter-and-preview.md).

O visual é especificado em [`docs/DESIGN.md`](docs/DESIGN.md) — todo valor visual do código resolve
para um token declarado em `web/app/globals.css`. O Figma de referência está linkado no topo do
DESIGN.md.

```bash
# 1. suba a API (porta 5218)
dotnet run --project src/AudioApi

# 2. em outro terminal, suba o front (porta 3000)
cd web
npm install
npm run dev
```

Abra <http://localhost:3000>. A API precisa permitir a origem do front — a seção `Cors` do
`appsettings.json` já libera `http://localhost:3000`. Para apontar para outra API:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run dev
```

Testes e build do front:

```bash
cd web
npm run test:run   # Vitest + React Testing Library
npm run build
```

## Pré-requisitos

- **.NET 10 SDK** (testado com `10.0.109`).
- **ffmpeg** disponível no `PATH` (usado para comprimir os áudios para AAC).
- **Docker** + **Docker Compose** — o caminho mais simples: sobe API e worker juntos, com o
  resumo funcionando, sem precisar de .NET nem de `ffmpeg` na máquina.
- Só para o resumo pelo `dotnet run`: o **worker Whisper** de pé — veja
  [`worker/audio-summary-worker/README.md`](worker/audio-summary-worker/README.md). Sem ele a API
  funciona normalmente e os áudios ficam com `summaryStatus: "Disabled"`.

## Como rodar em desenvolvimento

```bash
dotnet restore
dotnet run --project src/AudioApi
```

A API sobe em **http://localhost:5218** (perfil `http`).

Abra o **Swagger UI** em: **http://localhost:5218/swagger**
(o upload de arquivo funciona direto pela interface).

### Testando pelo arquivo `.http`

[`src/AudioApi/AudioApi.http`](src/AudioApi/AudioApi.http) traz **12 requisições prontas** — health,
upload real em `multipart`, metadados, resumo, download, listagem, os casos de erro (400/404) e o
OpenAPI cru. As requisições encadeiam o id da resposta do upload (`{{upload.response.body.id}}`),
então basta enviá-las em ordem.

- **VS Code:** extensão [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) → "Send Request".
- **Visual Studio / Rider:** suporte nativo, sem extensão.

Antes de rodar, gere o áudio de teste que o arquivo referencia (na raiz do repositório):

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 44100 -ac 2 test.wav
```

Para apontar para o Docker Compose, troque `@host` no topo do arquivo para `http://localhost:8080`.

### Exemplo: enviar um áudio

```bash
# gera um .wav de teste que o ffmpeg consegue decodificar de verdade
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 44100 -ac 2 test.wav

# envia (informando o content-type audio/wav)
curl -i -X POST http://localhost:5218/api/audios \
  -F "file=@test.wav;type=audio/wav"
```

Resposta (201 Created) — note que ela sai **antes** da compressão, então ainda descreve o arquivo
original:

```json
{
  "id": "bfbb5766-c677-402c-9d6c-990600514573",
  "originalFileName": "test.wav",
  "storedFileName": "bfbb5766c677402c9d6c990600514573.wav",
  "url": "http://localhost:5218/api/audios/bfbb5766-c677-402c-9d6c-990600514573/download",
  "contentType": "audio/wav",
  "sizeBytes": 882078,
  "createdAtUtc": "2026-08-08T15:57:06.96Z",
  "processingStatus": "Pending",
  "summaryStatus": "Pending"
}
```

Alguns instantes depois, o mesmo `GET /api/audios/{id}` mostra o trabalho do worker:

```json
{
  "storedFileName": "bfbb5766c677402c9d6c990600514573.m4a",
  "contentType": "audio/mp4",
  "sizeBytes": 81920,
  "processingStatus": "Completed"
}
```

Um arquivo que passa na validação mas **não** é áudio decodificável (por exemplo
`head -c 100000 /dev/urandom > lixo.wav`) também responde **201** — a falha aparece depois, em
`processingStatus: "Failed"` com o motivo em `processingError`.

### Exemplo: consultar metadados e baixar

```bash
ID=bfbb5766-c677-402c-9d6c-990600514573

# metadados
curl http://localhost:5218/api/audios/$ID

# baixar o arquivo
curl -o baixado.wav http://localhost:5218/api/audios/$ID/download

# baixar a versão filtrada (404 enquanto filterStatus não for "Completed")
curl -o baixado-filtrado.m4a http://localhost:5218/api/audios/$ID/download/filtered

# listar todos
curl http://localhost:5218/api/audios
```

## Como rodar com Docker Compose

```bash
docker compose up --build
```

Sobe **dois** serviços: a API e o worker Whisper que gera os resumos. A sumarização já vem
**ligada** nesse modo — não há passo manual, chave nem máquina externa.

A API fica disponível em **http://localhost:8080** (Swagger em
http://localhost:8080/swagger — o compose usa `ASPNETCORE_ENVIRONMENT=Development`).
O worker não é exposto ao host: só a API fala com ele, pela rede interna do compose.

> ⚠️ **Usando o front junto com o compose, aponte-o para a 8080.** O cliente web tem como padrão
> `http://localhost:5218`, que é a porta do `dotnet run` — com o compose ele bate numa porta onde
> não há nada e a tela mostra "API sem resposta". Crie `web/.env.local`:
>
> ```bash
> echo 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8080' > web/.env.local
> ```
>
> e **reinicie o `npm run dev`** — variáveis `NEXT_PUBLIC_*` são lidas no build, não a cada request.
> O CORS já permite `http://localhost:3000`; para outra origem, ajuste `Cors:AllowedOrigins`.

> ⚠️ **Depois de mudar código do servidor, rebuilde.** `docker compose up` sem `--build` sobe a
> imagem antiga e a API responde sem os campos novos (`processingStatus` e companhia), o que
> aparece no cliente como comportamento fantasma. Use `docker compose up -d --build`. Se o schema
> mudou, apague o volume também: `docker compose down -v`.

> **Primeira execução é lenta.** A imagem do worker instala o `faster-whisper` e, ao subir, baixa
> os pesos do modelo `tiny` (~75 MB). Eles ficam no volume `whisper-models`, então da segunda vez
> em diante o worker sobe offline. A API espera o `/health` do worker antes de aceitar tráfego.

Os dados são persistidos em volumes nomeados:

- `audio-data` → banco SQLite (`/app/data`)
- `audio-files` → arquivos de áudio (`/app/filestore`)
- `whisper-models` → pesos do modelo (baixados uma vez)

Dá para trocar o modelo sem editar o compose (`base`, `small`… são mais precisos e mais lentos):

```bash
WHISPER_MODEL=base docker compose up --build
```

Exemplo de upload contra o container:

```bash
curl -i -X POST http://localhost:8080/api/audios -F "file=@test.wav;type=audio/wav"
```

## Como rodar os testes

```bash
dotnet test
```

O projeto **`tests/AudioApi.Tests`** (xUnit) inclui:

- Testes de unidade da validação de áudio (rejeita `.txt`/não-áudio, aceita `.wav`, etc.).
- Teste de integração com `WebApplicationFactory`: faz `POST` de um `.wav` válido, valida
  **201**, recupera o registro via `GET` e via `/download`, e confirma que o arquivo baixado
  é o AAC comprimido (não os bytes originais). Usa um diretório de file store temporário e um
  banco SQLite temporário, sendo totalmente autocontido.
- Testes de unidade do `FfmpegAudioCompressor`: confirmam que um WAV válido é comprimido para
  um container AAC/M4A válido e que áudio não decodificável lança erro (ver
  [`docs/week2-analysis.md`](docs/week2-analysis.md)).
- Testes do resumo (**43 testes no total, todos verdes**, nenhum precisa de rede ou do worker):
  - `SummaryTruncatorTests`: o resumo **nunca** passa de 500 caracteres — transcrição longa, texto
    exatamente no limite, 501 caracteres, `null`/vazio, tetos arbitrários (1, 2, 10, 64, 120, 499,
    500), corte em fim de frase, `…` no corte por palavra e emoji não partido ao meio.
  - `WhisperAudioSummarizerTests`: com um worker stub devolvendo **5.000 caracteres**, o resultado
    sai com ≤ 500; erros HTTP, JSON inválido e resumo vazio viram exceção.
- `AudioSummaryIntegrationTests`: fluxo completo com um `IAudioSummarizer` falso — upload →
    `Pending` → `Completed` com resumo persistido ≤ 500; falha do summarizer → `Failed` sem quebrar
    o upload (segue 201); com a feature desligada → `Disabled`.

## Benchmark da Atividade #1

O modo otimizado/paralelo é o padrão. Para exercitar a baseline serial da API, defina
`Processing__ExecutionMode=Sequential`; para voltar, use `Parallel`. “Sequencial” significa que
jobs não se sobrepõem; os `await` de I/O, SQLite e do processo `ffmpeg` continuam necessários.

O harness executa os dois modos no mesmo binário, alterna a ordem das rodadas, cria banco/file
store novos, aquece o processo e grava p50/p95 do POST, makespan, jobs/s, estados e critério de
sucesso:

```bash
scripts/activity-1-sequential-benchmark.sh \
  --output docs/benchmarks/api-sequential-vs-parallel.csv \
  --force --rounds 3 --max-users 8 --fixture-duration-seconds 1 \
  --max-concurrency 4 --queue-capacity 10 --post-sla-ms 4000 \
  --terminal-deadline-seconds 30 --port 51829

scripts/activity-1-sequential-benchmark.sh \
  --output docs/benchmarks/api-sequential-vs-parallel-heavy.csv \
  --force --rounds 3 --max-users 16 --fixture-duration-seconds 10 \
  --max-concurrency 4 --queue-capacity 20 --post-sla-ms 4000 \
  --terminal-deadline-seconds 60 --port 51831
```

Para o cliente, `NEXT_PUBLIC_AUDIO_VALIDATION_MODE=sequential npm run dev` desliga o Worker
explicitamente. O benchmark headless do núcleo roda com:

```bash
cd web
npm run benchmark:client
```

Para medir o Worker real, suba `npm run dev`, abra `/benchmark` e clique em “Executar benchmark”;
essa página de instrumentação não altera dados da API. O relatório completo, os CSVs e as
limitações estão em [`docs/activity-1-sequential-vs-parallel-benchmark.md`](docs/activity-1-sequential-vs-parallel-benchmark.md).

### Gate de sandbox (Docker, sem rede, non-root)

```bash
docker compose -f docker-compose.dark-factory.yml up unit-tests \
  --build --abort-on-container-exit --exit-code-from unit-tests

docker compose -f docker-compose.dark-factory.yml --profile integration up integration \
  --build --abort-on-container-exit --exit-code-from integration
```

## Onde ficam os arquivos e o banco

Por padrão (relativo ao content root do projeto `src/AudioApi`):

- **Arquivos de áudio:** `./filestore/` (configurável em `Storage:LocalPath`).
- **Banco SQLite:** `./data/audios.db` (configurável em `ConnectionStrings:Default`).

No Docker esses caminhos são `/app/filestore` e `/app/data`, mapeados para volumes.

### Configuração (`appsettings.json`)

```jsonc
{
  "ConnectionStrings": { "Default": "Data Source=./data/audios.db" },
  "Storage": { "LocalPath": "./filestore" },
  "Upload": {
    "MaxSizeBytes": 52428800,          // 50 MB
    "AllowedExtensions": [ ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".webm" ]
  },
  "Compression": {
    "FfmpegPath": "ffmpeg",            // caminho/nome do binário do ffmpeg
    "BitrateKbps": 128                 // bitrate do AAC de saída
  },
  "Processing": {
    "ExecutionMode": "Parallel",       // Parallel (padrão) ou Sequential (baseline)
    "MaxConcurrency": 0,               // 0 (ou ausente) = número de processadores da máquina
    "QueueCapacity": 100               // fila cheia → HTTP 503 sem persistir upload
  },
  "Summarization": {
    "Enabled": false,                  // true liga o resumo; false = nunca toca a rede
    "ExecutionMode": "Parallel",       // Parallel (padrão) ou Sequential (baseline)
    "Endpoint": "http://localhost:9000", // base URL do worker Whisper
    "ApiKey": "",                      // enviado no header X-API-Key
    "TimeoutSeconds": 300,             // transcrição em CPU é lenta
    "MaxSummaryChars": 500,            // limitado ao teto de domínio de 500
    "MaxConcurrency": 1,               // transcrições simultâneas
    "QueueCapacity": 100               // fila cheia → resumo Failed, upload segue 201
  }
}
```

> **Banco existente:** o schema é criado com `EnsureCreated()` e o projeto não usa migrations, então
> as colunas de resumo e de processamento (`ProcessingStatus`, `ProcessingError`,
> `ProcessingUpdatedAtUtc`) **não** são adicionadas a um `data/audios.db` que já existe — o app
> quebra com `SQLite Error 1: 'no such column: a.ProcessingStatus'`. Apague o arquivo
> (`rm src/AudioApi/data/audios.db`) ou o volume `audio-data` do compose (`docker compose down -v`)
> antes de subir esta versão.

## Estrutura do projeto

```
Prog7.slnx
Dockerfile
Dockerfile.sandbox                     # imagem do gate (testes + smoke), non-root
docker-compose.yml
docker-compose.dark-factory.yml        # gate: unit-tests + integration
docker/sandbox/smoke.sh
src/AudioApi/
  Program.cs
  Data/AppDbContext.cs
  Data/IDbWriteGate.cs
  Data/DbWriteGate.cs                    # SemaphoreSlim(1,1): SQLite aceita um escritor
  Models/AudioFile.cs
  Models/ProcessingStatus.cs
  Models/SummaryStatus.cs
  Dtos/AudioFileDto.cs
  Dtos/AudioSummaryDto.cs
  Options/StorageOptions.cs
  Options/UploadOptions.cs
  Options/CompressionOptions.cs
  Options/AudioExecutionMode.cs
  Options/ProcessingOptions.cs
  Options/SummarizationOptions.cs
  Storage/IFileStore.cs
  Storage/LocalFileStore.cs
  Compression/IAudioCompressor.cs
  Compression/FfmpegAudioCompressor.cs
  Processing/IProcessingQueue.cs
  Processing/ProcessingQueue.cs          # Channel<Guid> limitado
  Processing/AudioProcessingBackgroundService.cs
  Summarization/IAudioSummarizer.cs
  Summarization/WhisperAudioSummarizer.cs
  Summarization/SummaryTruncator.cs      # a garantia dos ≤ 500 caracteres
  Summarization/ISummaryQueue.cs
  Summarization/SummaryQueue.cs          # Channel<Guid> limitado
  Summarization/AudioSummaryBackgroundService.cs
  Validation/AudioFileValidator.cs
  Endpoints/AudioEndpoints.cs
  AudioApi.http                          # requisições prontas para testar a API
tests/AudioApi.Tests/
  AudioFileValidatorTests.cs
  AudioApiIntegrationTests.cs
  AudioProcessingIntegrationTests.cs
  AudioSummaryIntegrationTests.cs
  FfmpegAudioCompressorTests.cs
  SummaryTruncatorTests.cs
  WhisperAudioSummarizerTests.cs
  TestAudio.cs
  TestEnvironment.cs
worker/audio-summary-worker/           # modelo local Whisper (Python + FastAPI)
  app.py
  summarizer.py
  requirements.txt
  Dockerfile
  docker-compose.yml
  README.md
docs/
  ARCHITECTURE.md                        # escopo, objetivos, componentes e diagramas
  presentation.html                      # slides (reveal.js, abrir no navegador)
  DESIGN.md
  week2-analysis.md
  week3-threading-explanation.md
  week4-threading-pipeline.md            # o pipeline em background e a medição
  week5-parallel-users-before-after.md   # usuários simultâneos, antes vs depois
  week6-frontend-parallel-validation.md  # validação em Web Worker antes do upload
  activity-1-sequential-vs-parallel-benchmark.md # baseline, métricas, gráficos e conclusões
  mr-activity-1.md                         # descrição e plano de testes do MR
  benchmarks/parallel-audio-capacity.csv # amostras brutas da escada de usuários
  benchmarks/api-sequential-vs-parallel.csv # API: workload curto, dados brutos
  benchmarks/api-sequential-vs-parallel-heavy.csv # API: workload pesado, dados brutos
  benchmarks/client-validation.json      # cliente: headless + Edge real
```
