# Week 2 — Análise: Compressão de Áudio e Threading

## O que foi implementado

- Todo áudio enviado (`POST /api/audios`) é transcodificado para **AAC** (container `.m4a`,
  codec `aac`, 128 kbps por padrão) usando o binário `ffmpeg` via `System.Diagnostics.Process`.
- O arquivo **comprimido** é o único gravado no File Store (`IFileStore`/`LocalFileStore`);
  os bytes originais nunca são persistidos — só existem temporariamente em disco durante a
  conversão e são apagados logo em seguida (`Path.GetTempFileName`, removidos em `finally`/`catch`,
  e o arquivo de saída usa `FileOptions.DeleteOnClose`).
- O registro em banco passa a guardar `ContentType = "audio/mp4"` e `StoredFileName` com
  extensão `.m4a`, independente do formato original enviado (wav, mp3, ogg, flac, webm, etc.).
- Logs de tempo de compressão foram adicionados em `FfmpegAudioCompressor`
  (`AudioApi.Compression.FfmpegAudioCompressor`), medindo com `Stopwatch` o tempo gasto no
  processo `ffmpeg`, além do tamanho de entrada/saída e o bitrate usado. Exemplo real capturado
  localmente:

  ```
  Áudio comprimido para AAC em 66ms (entrada: 16078 bytes, saída: 4960 bytes, taxa: 128kbps)
  ```

- Falhas de compressão (ex.: arquivo que passa na validação de extensão/content-type mas não é
  um áudio decodificável de fato) retornam **422 Unprocessable Entity** em vez de deixar a
  requisição quebrar com 500.

## É o momento certo para threading?

**Conclusão: não, ainda não.** Threading manual (criar `Thread`/`Task.Run` para "paralelizar" a
compressão, filas de workers, etc.) adicionaria complexidade sem resolver nenhum problema real
no estágio atual do projeto. Motivos:

1. **A concorrência já existe e é gratuita.** ASP.NET Core (Kestrel) já atende cada requisição
   HTTP em uma thread do thread pool, e todo o pipeline atual é `async`/`await` de ponta a ponta
   (`UploadAsync`, `CompressToAacAsync`, EF Core, `FileStream`). Múltiplos uploads simultâneos já
   são processados em paralelo pelo runtime — não é necessário nenhum código de threading manual
   para isso acontecer.

2. **O trabalho pesado já roda fora da thread do request.** A compressão em si não ocorre na
   thread .NET: `ffmpeg` é um **processo do sistema operacional** separado, e o
   `Process.WaitForExitAsync` libera a thread do ASP.NET Core enquanto o SO agenda o `ffmpeg` em
   outro processo/CPU. Ou seja, o paralelismo de CPU pesado (a codificação AAC) já acontece fora
   do processo da aplicação; "adicionar threading" aqui seria paralelizar algo que o SO já está
   paralelizando.

3. **Não há indício de gargalo.** O volume de uploads é baixo (projeto acadêmico, uso individual),
   e a compressão de arquivos de alguns MB leva dezenas/poucas centenas de milissegundos (medido:
   66ms para ~16KB de entrada; áudios reais de alguns minutos ficam na casa de 1-3s). Introduzir
   filas, workers em background ou processamento assíncrono desacoplado do request
   (`IHostedService` + fila) só se justifica quando:
   - o tempo de compressão passar a impactar perceptivelmente o tempo de resposta do
     `POST /api/audios` (ex.: arquivos grandes, > alguns segundos de processamento), **e/ou**
   - o volume de uploads concorrentes começar a saturar o processo (muitos `ffmpeg` rodando ao
     mesmo tempo competindo por CPU/memória do host).

4. **Custo de threading manual agora seria negativo.** Adicionar fila + worker background traria:
   necessidade de tornar o upload assíncrono (endpoint precisaria responder "processando" e o
   cliente teria que fazer polling ou usar webhook), estado adicional para rastrear
   status de processamento, tratamento de falhas/retries do worker, e testes bem mais complexos —
   tudo isso sem nenhum problema de performance real para justificar.

### Quando revisitar

Se no futuro o projeto evoluir para:
- aceitar uploads muito maiores ou em lote,
- ter múltiplos usuários enviando áudio simultaneamente em volume alto,
- precisar limitar quantos `ffmpeg` rodam ao mesmo tempo (para não estourar CPU/memória do host),

então faz sentido introduzir um **limitador de concorrência** (ex.: `SemaphoreSlim` global para
capar quantas compressões rodam em paralelo) e, se o tempo de resposta do upload virar um
problema de UX, migrar a compressão para um **worker em background** (fila em memória ou
`IHostedService` + `Channel<T>`), com o endpoint de upload retornando imediatamente e o cliente
consultando o status via `GET /api/audios/{id}`. Nenhuma dessas mudanças é necessária hoje.

## Testes adicionados

- `tests/AudioApi.Tests/FfmpegAudioCompressorTests.cs`: testa a unidade `FfmpegAudioCompressor`
  isoladamente — comprime um WAV válido gerado em memória e verifica que a saída é um container
  MP4/M4A válido (assinatura `ftyp`), e que áudio não decodificável lança `InvalidOperationException`.
- `tests/AudioApi.Tests/AudioApiIntegrationTests.cs`: o teste de upload agora envia um WAV PCM
  válido (helper `TestAudio.CreateValidWavBytes`) e verifica que o arquivo devolvido pelo
  `/download` é o AAC comprimido (diferente dos bytes originais, com assinatura `ftyp`, extensão
  `.m4a` e `Content-Type: audio/mp4`). Um novo teste cobre o caso de áudio não decodificável
  (`422 Unprocessable Entity`).
