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
  `ContentType`, `SizeBytes`, `CreatedAtUtc`.
- Expõe endpoints para consultar os metadados, baixar o arquivo (já comprimido) e listar tudo.

### Compressão de áudio (AAC)

Todo áudio enviado é transcodificado para **AAC** (container `.m4a`, 128 kbps por padrão) via
`ffmpeg` (`AudioApi.Compression.FfmpegAudioCompressor`) antes de ser salvo no file store — o
arquivo original nunca é persistido. O tempo de compressão é medido e logado
(`Áudio comprimido para AAC em {ms}ms ...`). Se o arquivo não puder ser decodificado como áudio,
a API responde **422 Unprocessable Entity**. Ver análise completa em
[`docs/week2-analysis.md`](docs/week2-analysis.md), incluindo a discussão sobre threading.

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
| GET    | `/api/audios`                 | Lista todos os registros.                        |
| GET    | `/health`                     | Verificação de saúde.                            |

## Pré-requisitos

- **.NET 10 SDK** (testado com `10.0.109`).
- **ffmpeg** disponível no `PATH` (usado para comprimir os áudios para AAC).
- Opcional: **Docker** + **Docker Compose** (a imagem já instala o `ffmpeg`).

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
  }
}
```

## Estrutura do projeto

```
Prog7.slnx
Dockerfile
docker-compose.yml
src/AudioApi/
  Program.cs
  Data/AppDbContext.cs
  Models/AudioFile.cs
  Dtos/AudioFileDto.cs
  Options/StorageOptions.cs
  Options/UploadOptions.cs
  Options/CompressionOptions.cs
  Storage/IFileStore.cs
  Storage/LocalFileStore.cs
  Compression/IAudioCompressor.cs
  Compression/FfmpegAudioCompressor.cs
  Validation/AudioFileValidator.cs
  Endpoints/AudioEndpoints.cs
tests/AudioApi.Tests/
  AudioFileValidatorTests.cs
  AudioApiIntegrationTests.cs
  FfmpegAudioCompressorTests.cs
  TestAudio.cs
docs/
  week2-analysis.md
```
