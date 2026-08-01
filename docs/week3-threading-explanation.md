# Week 3 — Extrator de resumo de áudio e threading

## O que foi implementado

Um **extrator de resumo de áudio**: todo upload passa a ser transcrito por um modelo de IA leve
rodando localmente e o resultado é reduzido a um **resumo de no máximo 500 caracteres**, persistido
junto com os metadados do áudio.

O ponto central desta semana não é a transcrição em si — é **onde** ela roda. A compressão da
semana 2 era rápida o suficiente para ficar dentro da requisição HTTP; a transcrição não é. Foi
aqui que o projeto finalmente ganhou **threading de verdade**: uma fila em memória e um worker em
background, exatamente as condições que a análise da semana 2 listou como gatilho
([`docs/week2-analysis.md`](week2-analysis.md), seção "Quando revisitar").

### Fluxo completo

```
POST /api/audios
  │
  ├─ AudioFileValidator          valida nome/content-type/tamanho      → 400 se inválido
  ├─ FfmpegAudioCompressor       transcodifica para AAC (.m4a)         → 422 se não decodificável
  ├─ LocalFileStore              grava só o arquivo comprimido
  ├─ AppDbContext                salva a linha AudioFile (SummaryStatus = Pending)
  ├─ ISummaryQueue.TryEnqueue    enfileira só o Guid
  └─ 201 Created  ────────────────────────────────────────────► resposta sai aqui (~200ms)

        ⋮ (outra thread, outro escopo de DI, depois da resposta)

AudioSummaryBackgroundService
  ├─ SemaphoreSlim               limita quantos áudios processam em paralelo
  ├─ IServiceScopeFactory        cria um escopo novo (AppDbContext é scoped)
  ├─ SummaryStatus = Processing  grava a transição
  ├─ IFileStore.OpenReadAsync    relê os bytes já comprimidos
  ├─ WhisperAudioSummarizer      HTTP POST /summarize → worker Whisper
  ├─ SummaryTruncator.Clamp      garante ≤ 500 caracteres
  └─ SummaryStatus = Completed | Failed
```

O cliente descobre o resultado via **polling** em `GET /api/audios/{id}/summary`.

### O modelo de IA leve (local)

A transcrição usa **Whisper `tiny`** através do
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (runtime CTranslate2), quantizado em
**int8**, em **CPU**. É o modelo mais leve da família Whisper (~39M parâmetros, ~75MB de pesos) e
roda inteiramente **local**: nenhuma chamada para OpenAI, Anthropic, Google ou qualquer API paga.
Os pesos são baixados uma única vez e ficam em um volume Docker.

O modelo **não roda dentro da API .NET**. Ele vive em um worker HTTP separado
(`worker/audio-summary-worker/`, Python + FastAPI) hospedado numa VPS, e a API é apenas um cliente
HTTP fino (`WhisperAudioSummarizer`). Três razões:

1. **Ecossistema.** As implementações maduras e leves de Whisper são Python/C++. Colocar isso
   dentro do processo .NET significaria embutir ONNX Runtime ou bindings nativos de whisper.cpp —
   muito mais peso e complexidade de build do que um `HttpClient`.
2. **Isolamento de recurso.** Transcrição é CPU-bound e pesada. Rodando fora do processo da API,
   um pico de transcrição não compete com o thread pool que atende as requisições HTTP, e o
   container do worker tem seus próprios limites (`memory: 3G`, `WHISPER_CPU_THREADS`).
3. **Substituibilidade.** Trocar `tiny` por `base`/`small`, ou o worker inteiro por outra
   implementação, é mudar uma variável de ambiente ou uma URL. A API não sabe o que existe do
   outro lado — só que existe um contrato `POST /summarize`.

Do ponto de vista do .NET, isso é o mesmo padrão da semana 2: **trabalho pesado fora do processo**,
consumido de forma assíncrona. `ffmpeg` é um processo filho; o Whisper é um serviço HTTP.

### O resumo, e por que ele não é a transcrição

O worker faz duas coisas:

1. **Transcreve** o áudio (Whisper) → texto verbatim, que pode ter dezenas de milhares de caracteres.
2. **Resume** essa transcrição de forma **extrativa** (`worker/audio-summary-worker/summarizer.py`):
   quebra em frases, pontua cada frase por frequência de termos de conteúdo (stopwords de
   pt/en/es removidas, normalizada pelo tamanho da frase, com um leve bônus para as frases
   iniciais), escolhe gulosamente as frases de maior pontuação que **cabem no orçamento de
   caracteres** e as reemite na ordem original.

A transcrição completa **nunca é persistida** pela API — só o resumo. Vale ser explícito sobre a
divisão de trabalho: a parte de **IA** é o Whisper (o modelo que entende a fala); a sumarização é
um algoritmo clássico de NLP, determinístico e sem modelo. Essa escolha é deliberada:

- um segundo modelo (um LLM pequeno para resumo abstrativo) custaria mais RAM que a VPS tem
  sobrando e somaria dezenas de segundos por áudio;
- resumo extrativo é determinístico — dá para testar de verdade, sem flakiness;
- para áudios curtos (o caso comum aqui) a transcrição já cabe em 500 caracteres e o resumo é
  simplesmente ela própria.

Se um resumo abstrativo virar requisito, o ponto de troca é uma função dentro do worker. A API não
muda.

### A garantia dos 500 caracteres

O limite é aplicado em **três camadas independentes**, de propósito:

| Camada | Onde | O que garante |
|--------|------|---------------|
| 1 | `summarizer.py` no worker | monta o resumo já dentro do orçamento de caracteres |
| 2 | `SummaryTruncator.Clamp` na API | reaplica o corte no que o worker devolveu |
| 3 | coluna `Summary` no banco | `HasMaxLength(500)` |

A camada 2 é a que importa e é a que está coberta por testes de unidade. As camadas 1 e 3 valem
enquanto o worker for este worker e o banco for este banco; a camada 2 continua valendo quando o
worker for atualizado, trocado, ou responder algo maior que o combinado — a API não terceiriza uma
invariante do seu próprio domínio para um serviço externo.

`SummaryTruncator.Clamp` normaliza espaços em branco e então corta, em ordem de preferência:
no fim de uma frase (sem reticências), no fim de uma palavra (com `…`), ou no meio da palavra
(com `…`, sem quebrar pares de substitutos UTF-16). A pós-condição é
`resultado.Length <= maxChars` para **qualquer** entrada, incluindo `null`.

---

## É o momento certo para threading?

**Conclusão: sim, agora é.** A semana 2 concluiu "ainda não" e listou o que mudaria essa resposta.
O extrator de resumo mudou exatamente esses fatores.

### 1. A diferença de ordem de grandeza é real, e medida

Medições reais deste projeto, mesmo áudio (`jfk.wav`, 11 segundos de fala, 352 KB):

```
Áudio comprimido para AAC em 160ms (entrada: 352078 bytes, saída: 98479 bytes, taxa: 128kbps)
Resumo de 4c34be9c-2502-4292-85ab-ee7d6fa9b565 concluído em 1435ms (106 caracteres)
```

A sumarização custou **~9x** a compressão para o mesmo arquivo. E esse é o **melhor** caso:

- 11 segundos de áudio → ~1,0s de transcrição no worker (Whisper `tiny`, int8, 4 vCPUs).
  Isso é cerca de **10x tempo real**;
- extrapolando: um áudio de **5 minutos** custa ~30s; o limite de upload de **50 MB**
  (≈ 1 hora de MP3 a 128kbps) custaria da ordem de **6 minutos** — mais uma rede de por meio.

Um `POST` que responde em 200ms e um `POST` que responde em 6 minutos não são a mesma operação.
O segundo estoura timeout de proxy, de navegador e de cliente HTTP; ocupa uma conexão o tempo todo;
e não dá ao cliente nenhuma forma de saber se algo está acontecendo. É esse salto de escala — não
uma preferência de arquitetura — que justifica sair da thread da requisição.

### 2. `async/await` não resolve este problema (e é por isso que threading entra aqui)

Vale separar duas coisas que a semana 2 tratou juntas:

- `async/await` resolve **ocupação de thread**: enquanto o `ffmpeg` roda ou o HTTP viaja, a thread
  do ASP.NET Core volta para o pool. Isso continua valendo — `WhisperAudioSummarizer` é
  totalmente assíncrono e não bloqueia nada.
- `async/await` **não** resolve **latência de resposta**: `await` não faz a requisição terminar
  antes. Se a operação leva 6 minutos, o `await` leva 6 minutos.

A semana 2 podia se apoiar só no primeiro ponto porque 66ms de latência não incomodavam ninguém.
Aqui o problema é o segundo, e o único jeito de resolver é **desacoplar o trabalho da requisição** —
ou seja, threading de verdade: um produtor (o endpoint) e um consumidor (o worker) rodando em
threads diferentes, com uma fila no meio.

### 3. Falha e retentativa deixam de ser triviais

Compressão falha de um jeito só: o arquivo não é áudio. É determinístico e local, cabe num 422.

Sumarização falha de muitos jeitos que **não são culpa do cliente**: o worker está reiniciando, a
rede caiu, o modelo ainda está carregando, o áudio não tem fala. Nenhum desses merece derrubar o
upload — o áudio está válido e armazenado. Isso exige um lugar para registrar "o arquivo está bom,
o resumo não saiu", que é exatamente o `SummaryStatus`/`SummaryError` na linha do `AudioFile`.
Estado de processamento persistido só faz sentido se o processamento é assíncrono.

---

## As primitivas de threading escolhidas, e por quê

### `Channel<Guid>` limitado — a fila (`SummaryQueue`)

`System.Threading.Channels` é a fila produtor/consumidor da BCL: assíncrona, thread-safe, zero
dependências novas. Duas decisões:

- **Limitada** (`CreateBounded`, capacidade 100). Uma fila ilimitada transforma uma rajada de
  uploads em crescimento ilimitado de memória, porque o Whisper drena muito mais devagar do que o
  HTTP enche. O limite é a contrapressão do sistema.
- **`FullMode = DropWrite` + `TryEnqueue`**, nunca `await WriteAsync`. Esperar por vaga na fila
  colocaria a lentidão do Whisper de volta dentro da requisição — justamente o que a mudança toda
  existe para evitar. Fila cheia é uma resposta imediata: o upload continua **201**, e aquele áudio
  fica `Failed` com o motivo explícito. Perder o resumo em silêncio seria pior que qualquer uma das
  duas alternativas.

**Só o `Guid` atravessa a fila.** Nada de streams, nada de `DbContext`, nada de `HttpContext` —
qualquer um deles estaria descartado quando o consumidor acordasse. O consumidor relê os bytes pelo
file store e o estado pelo banco.

### `BackgroundService` — o consumidor (`AudioSummaryBackgroundService`)

`IHostedService`/`BackgroundService` é o mecanismo de primeira classe do ASP.NET Core para trabalho
de longa duração: participa do ciclo de vida do host, recebe o `stoppingToken` no shutdown e é
registrado com uma linha (`AddHostedService`). Não há motivo para `new Thread(...)` nem
`Task.Run` solto — os dois ficariam fora do ciclo de vida da aplicação e sem cancelamento.

Detalhes que importam:

- **Escopo de DI próprio por job.** `AppDbContext` é `scoped`; o escopo da requisição que
  enfileirou já morreu. Usar aquele contexto seria um `ObjectDisposedException` na melhor das
  hipóteses e corrupção de estado de mudança na pior. O serviço chama `IServiceScopeFactory`
  e resolve um `AppDbContext` novo por job.
- **Uma falha de job nunca derruba o loop.** Se uma exceção escapasse do `ExecuteAsync`, o
  `BackgroundService` pararia e a fila **inteira** morreria em silêncio pelo resto da vida do
  processo. Cada job roda dentro de `try/catch` (`ProcessGuardedAsync`), o erro é logado e
  gravado na linha, e o loop segue.
- **Cancelamento no shutdown.** O `stoppingToken` propaga até o `HttpClient`. O bloco `finally`
  espera (`Task.WhenAll`) os jobs já iniciados antes de sair, para não descartar o semáforo
  debaixo de tarefas em andamento.

### `SemaphoreSlim` — o limite de concorrência

`Summarization:MaxConcurrency` (padrão **1**) limita quantos áudios são transcritos ao mesmo tempo.
Sem esse limite, 20 uploads simultâneos viram 20 transcrições simultâneas num worker de 4 vCPUs:
todas ficam lentas, a memória sobe e o resultado é pior do que se tivessem sido feitas em fila.
`SemaphoreSlim` é a primitiva certa porque tem `WaitAsync` — esperar por vaga não queima uma
thread. O worker ainda tem seu próprio `asyncio.Lock` do lado Python, então o limite é aplicado nas
duas pontas.

### Resumo das escolhas

| Escolha | Alternativa rejeitada | Por quê |
|---------|----------------------|---------|
| Fila em memória (`Channel`) | Redis / RabbitMQ / Azure Queue | Uma instância, projeto acadêmico. Fila externa = nova dependência de infra sem problema que a justifique |
| Fila limitada | Fila ilimitada | Sem limite, uma rajada come a memória do processo |
| `TryEnqueue` (não bloqueia) | `await WriteAsync` | Bloquear devolveria a latência do Whisper para dentro do request |
| `BackgroundService` | `Task.Run` / `new Thread` | Ciclo de vida do host, `stoppingToken`, shutdown limpo |
| Escopo de DI por job | Reusar o contexto do request | O escopo do request já foi descartado |
| `SemaphoreSlim(1)` | Concorrência ilimitada | 4 vCPUs no worker; paralelismo demais deixa tudo mais lento |
| Polling em `GET /{id}/summary` | Webhook / SignalR | Polling resolve o caso de uso com zero infra nova |

---

## O que **não** foi feito (e o gatilho para fazer)

Deliberadamente fora de escopo, para manter o diff honesto:

- **Retentativa com backoff.** Um `Failed` continua `Failed`; reenviar o áudio é a alternativa.
  Retentativa só faz sentido junto com contagem de tentativas persistida e política de descarte,
  senão um erro permanente (áudio sem fala) fica em loop. *Gatilho: falhas transitórias do worker
  virarem comuns em produção.*
- **Persistência da fila.** Se o processo cai, os jobs `Pending` em memória se perdem e a linha
  fica `Pending` para sempre. *Gatilho: quando perder um resumo passar a importar — a correção é
  varrer `Pending` antigos no startup e reenfileirar, não trocar de tecnologia de fila.*
- **Fila distribuída / múltiplas instâncias.** Com duas instâncias da API, cada uma teria a sua
  fila em memória e o `SemaphoreSlim` deixaria de limitar o total no worker. *Gatilho: escalar
  horizontalmente.*
- **Retenção da transcrição completa.** Hoje só o resumo é persistido. *Gatilho: precisar de busca
  por conteúdo falado.*
- **Diarização / timestamps / tradução.** O worker já recebe isso do Whisper e joga fora.

---

## Testes

`tests/AudioApi.Tests/SummaryTruncatorTests.cs` — o núcleo da garantia dos 500 caracteres, testado
puro (sem rede, sem banco, sem worker):

- transcrição longa (200 frases) → resumo com `Length <= 500`;
- texto de exatamente 500 caracteres → devolvido intacto;
- texto de 501 caracteres → cabe em 500;
- `null`, `""`, só espaços → string vazia;
- teto arbitrário (1, 2, 10, 64, 120, 499, 500) → **nunca** excede o teto;
- teto ≤ 0 → string vazia;
- espaços em branco colapsados; corte preferindo fim de frase; `…` no corte por palavra;
- pares de substitutos UTF-16 (emoji) não são partidos.

`tests/AudioApi.Tests/WhisperAudioSummarizerTests.cs` — o contrato com o worker, usando um
`HttpMessageHandler` stub (sem rede):

- **worker devolve 5.000 caracteres → o resultado tem ≤ 500** (a camada 2 fazendo seu trabalho);
- resumo dentro do limite passa intacto, com idioma e tamanho da transcrição;
- worker responde 503 / JSON inválido / resumo vazio → `InvalidOperationException`.

`tests/AudioApi.Tests/AudioSummaryIntegrationTests.cs` — o fluxo completo com
`WebApplicationFactory` e um `IAudioSummarizer` falso (sem VPS):

- upload → `Pending` → polling → `Completed` com **resumo persistido ≤ 500 caracteres**,
  `summaryLength` coerente e `maxSummaryLength = 500`;
- resumo curto é armazenado intacto;
- summarizer que lança → `Failed` com `error` preenchido, **e o upload continua 201**;
- `Summarization:Enabled = false` → `Disabled`, nada enfileirado;
- `GET /{id}/summary` de id inexistente → 404.

Total: **43 testes, todos verdes**, e nenhum precisa de rede, do worker ou da VPS —
`Summarization:Enabled` é `false` por padrão exatamente para isso.

### Verificação manual real (não só testes)

Executado de ponta a ponta contra o worker Whisper na VPS, através de um túnel SSH:

```
POST /api/audios (jfk.wav, 11s de fala)
  → 201, summaryStatus: "Pending"
GET  /api/audios/{id}/summary
  → [1] Pending  [2] Processing  [3] Completed
{
  "status": "Completed",
  "summary": "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.",
  "summaryLength": 106,
  "maxSummaryLength": 500,
  "language": "en"
}
```

Log da aplicação:

```
Worker de resumo iniciado (endpoint: http://localhost:9000, concorrência: 1, limite: 500 caracteres).
Áudio comprimido para AAC em 160ms (entrada: 352078 bytes, saída: 98479 bytes, taxa: 128kbps)
Áudio armazenado: 4c34be9c-2502-4292-85ab-ee7d6fa9b565 (jfk.wav)
Resumo gerado para jfk.wav: 106 caracteres a partir de 106 de transcrição (idioma: en, modelo: tiny).
Resumo de 4c34be9c-2502-4292-85ab-ee7d6fa9b565 concluído em 1435ms (106 caracteres).
```

Os três estados (`Pending` → `Processing` → `Completed`) aparecendo em polls consecutivos são a
prova observável de que o trabalho saiu da thread da requisição: o `201` foi entregue antes de o
resumo existir.

---

## Configuração

`appsettings.json` (seção nova; padrões seguros para CI e testes):

```jsonc
{
  "Summarization": {
    "Enabled": false,                        // true para ligar; false = nunca toca a rede
    "Endpoint": "http://localhost:9000",     // base URL do worker
    "ApiKey": "",                            // enviado no header X-API-Key
    "TimeoutSeconds": 300,                   // transcrição em CPU é lenta
    "MaxSummaryChars": 500,                  // limitado ao teto de domínio de 500
    "MaxConcurrency": 1,                     // transcrições simultâneas
    "QueueCapacity": 100                     // fila cheia → resumo Failed, upload segue 201
  }
}
```

Como rodar contra o worker na VPS (worker ouvindo apenas em `127.0.0.1` na VPS; o túnel SSH é o
caminho de acesso):

```bash
ssh -N -L 9000:127.0.0.1:9000 ovh-vps &

Summarization__Enabled=true \
Summarization__Endpoint=http://localhost:9000 \
Summarization__ApiKey=<WORKER_API_KEY> \
dotnet run --project src/AudioApi
```

Instruções do worker (build, deploy, variáveis, escolha de modelo):
[`worker/audio-summary-worker/README.md`](../worker/audio-summary-worker/README.md).

> **Atenção ao banco existente:** o schema é criado com `EnsureCreated()` e o projeto não usa
> migrations. As colunas novas (`Summary`, `SummaryStatus`, `SummaryLanguage`, `SummaryError`,
> `SummaryUpdatedAtUtc`) **não** são adicionadas a um `data/audios.db` que já existe. Apague o
> arquivo (`rm src/AudioApi/data/audios.db`) ou o volume `audio-data` do compose antes de subir.
