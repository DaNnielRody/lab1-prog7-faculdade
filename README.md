# Prog7 — Audio Upload API

API em **ASP.NET Core (.NET 10)** que recebe arquivos de áudio, armazena os bytes em um
**File Store** e registra em um banco de dados o **UUID** do arquivo junto com a **URL**
do file store e os demais metadados.

## O que o projeto faz

- Recebe um arquivo de áudio via `multipart/form-data`.
- Valida se o upload é realmente um áudio (por content-type `audio/*` **ou** por extensão).
- Gera um `Guid` (UUID) para o arquivo, **comprime o áudio para AAC** (`.m4a`, via `ffmpeg`) e
  grava apenas o arquivo comprimido no file store.
- Persiste um registro no banco com: `Id`, `OriginalFileName`, `StoredFileName`, `Url`,
  `ContentType`, `SizeBytes`, `CreatedAtUtc` e os campos de resumo (`Summary`, `SummaryStatus`,
  `SummaryLanguage`, `SummaryError`, `SummaryUpdatedAtUtc`).
- **Extrai um resumo do áudio (≤ 500 caracteres)** com um modelo de IA leve local (Whisper `tiny`),
  em um **worker em background** — fora da thread da requisição.
- Expõe endpoints para consultar os metadados, baixar o arquivo (já comprimido), consultar o resumo
  e listar tudo.

### Compressão de áudio (AAC)

Todo áudio enviado é transcodificado para **AAC** (container `.m4a`, 128 kbps por padrão) via
`ffmpeg` (`AudioApi.Compression.FfmpegAudioCompressor`) antes de ser salvo no file store — o
arquivo original nunca é persistido. O tempo de compressão é medido e logado
(`Áudio comprimido para AAC em {ms}ms ...`). Se o arquivo não puder ser decodificado como áudio,
a API responde **422 Unprocessable Entity**. Ver análise completa em
[`docs/week2-analysis.md`](docs/week2-analysis.md), incluindo a discussão sobre threading.

### Resumo de áudio (Whisper local, ≤ 500 caracteres)

Depois de armazenado, o áudio é transcrito por **Whisper `tiny`**
([faster-whisper](https://github.com/SYSTRAN/faster-whisper), int8, CPU) e reduzido a um **resumo de
no máximo 500 caracteres**. O modelo roda **local**, em um worker HTTP separado
(`worker/audio-summary-worker/`) — nenhuma API paga de IA é usada.

O trabalho **não acontece durante o `POST`**: o upload enfileira apenas o `Guid` numa fila limitada
(`Channel<Guid>`) e responde **201** com `summaryStatus: "Pending"`. Um `BackgroundService`
consome a fila, chama o worker e grava o resultado. O cliente acompanha via
`GET /api/audios/{id}/summary` (`Pending` → `Processing` → `Completed` | `Failed`).

Isso é o oposto da conclusão da semana 2, e de propósito: a compressão custou 160ms para um arquivo
onde a sumarização custou 1435ms (~9x), e a transcrição escala com a **duração** do áudio (~10x
tempo real), então um upload de 50 MB levaria minutos. O raciocínio completo — primitivas
escolhidas, alternativas rejeitadas e o que ficou de fora — está em
[`docs/week3-threading-explanation.md`](docs/week3-threading-explanation.md).

O limite de 500 caracteres é garantido em três camadas independentes: no worker, na API
(`SummaryTruncator.Clamp`, coberto por testes) e na coluna do banco (`HasMaxLength(500)`).

A sumarização vem **desligada** (`Summarization:Enabled = false`) para que `dotnet test` e o CI
nunca dependam de rede. Para ligar, veja
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
| POST   | `/api/audios`                 | Envia um áudio (`multipart/form-data`, campo `file`). Retorna **201 Created** + `Location`. |
| GET    | `/api/audios/{id}`            | Retorna os metadados do registro (404 se não existir). |
| GET    | `/api/audios/{id}/download`   | Faz o streaming dos bytes do arquivo (404 se não existir). |
| GET    | `/api/audios/{id}/summary`    | Retorna o resumo (≤ 500 caracteres) e o estado da sumarização (404 se não existir). |
| GET    | `/api/audios`                 | Lista todos os registros.                        |
| GET    | `/health`                     | Verificação de saúde.                            |

## Pré-requisitos

- **.NET 10 SDK** (testado com `10.0.109`).
- **ffmpeg** disponível no `PATH` (usado para comprimir os áudios para AAC).
- Opcional: **Docker** + **Docker Compose** (a imagem já instala o `ffmpeg`).
- Opcional (só para o resumo): o **worker Whisper** rodando e alcançável — veja
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

### Exemplo: enviar um áudio

```bash
# gera um arquivo .wav de teste
head -c 100000 /dev/urandom > test.wav

# envia (informando o content-type audio/wav)
curl -i -X POST http://localhost:5218/api/audios \
  -F "file=@test.wav;type=audio/wav"
```

Resposta (201 Created):

```json
{
  "id": "bfbb5766-c677-402c-9d6c-990600514573",
  "originalFileName": "test.wav",
  "storedFileName": "bfbb5766c677402c9d6c990600514573.m4a",
  "url": "http://localhost:5218/api/audios/bfbb5766-c677-402c-9d6c-990600514573/download",
  "contentType": "audio/mp4",
  "sizeBytes": 8213,
  "createdAtUtc": "2026-07-12T23:30:44.21Z"
}
```

### Exemplo: consultar metadados e baixar

```bash
ID=bfbb5766-c677-402c-9d6c-990600514573

# metadados
curl http://localhost:5218/api/audios/$ID

# baixar o arquivo
curl -o baixado.wav http://localhost:5218/api/audios/$ID/download

# listar todos
curl http://localhost:5218/api/audios
```

## Como rodar com Docker Compose

```bash
docker compose up --build
```

A API fica disponível em **http://localhost:8080** (Swagger em
http://localhost:8080/swagger — o compose usa `ASPNETCORE_ENVIRONMENT=Development`).

Os dados são persistidos em volumes nomeados:

- `audio-data` → banco SQLite (`/app/data`)
- `audio-files` → arquivos de áudio (`/app/filestore`)

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
  "Summarization": {
    "Enabled": false,                  // true liga o resumo; false = nunca toca a rede
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
> as colunas de resumo **não** são adicionadas a um `data/audios.db` que já existe. Apague o arquivo
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
  Models/AudioFile.cs
  Models/SummaryStatus.cs
  Dtos/AudioFileDto.cs
  Dtos/AudioSummaryDto.cs
  Options/StorageOptions.cs
  Options/UploadOptions.cs
  Options/CompressionOptions.cs
  Options/SummarizationOptions.cs
  Storage/IFileStore.cs
  Storage/LocalFileStore.cs
  Compression/IAudioCompressor.cs
  Compression/FfmpegAudioCompressor.cs
  Summarization/IAudioSummarizer.cs
  Summarization/WhisperAudioSummarizer.cs
  Summarization/SummaryTruncator.cs      # a garantia dos ≤ 500 caracteres
  Summarization/ISummaryQueue.cs
  Summarization/SummaryQueue.cs          # Channel<Guid> limitado
  Summarization/AudioSummaryBackgroundService.cs
  Validation/AudioFileValidator.cs
  Endpoints/AudioEndpoints.cs
tests/AudioApi.Tests/
  AudioFileValidatorTests.cs
  AudioApiIntegrationTests.cs
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
  week2-analysis.md
  week3-threading-explanation.md
```
