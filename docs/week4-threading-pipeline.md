# Semana 4 — Pipeline de processamento em background

## O que foi implementado

A **compressão saiu da thread da requisição**. O `POST /api/audios` não roda mais `ffmpeg`: ele
valida, grava os bytes originais, cria a linha e responde **201**. Um segundo worker em
background comprime para AAC, substitui o arquivo armazenado pelo `.m4a` e só então enfileira a
sumarização.

No cliente, a tela passou a listar os áudios já processados, **cada um mostrando o seu resumo**.

A semana 3 tinha tirado a sumarização da requisição e deixado a compressão dentro dela, com o
argumento — correto na época — de que 160ms para um áudio de 11 segundos não incomodava
([`docs/week3-threading-explanation.md`](week3-threading-explanation.md)). Esta semana fecha essa
lacuna: o argumento valia para 11 segundos de áudio, não para o limite real de upload.

### Fluxo completo

```
POST /api/audios
  ├ AudioFileValidator            valida nome/content-type/tamanho     → 400 se inválido
  ├ LocalFileStore.SaveAsync      grava os bytes ORIGINAIS (.wav/.mp3/…)
  ├ AppDbContext                  linha AudioFile
  │                                 ProcessingStatus = Pending
  │                                 SummaryStatus    = Pending | Disabled
  ├ IProcessingQueue.TryEnqueue   enfileira só o Guid
  └ 201 Created ───────────────────────────────────────────► resposta sai aqui (~0,2s)

      ⋮ thread de background #1, escopo de DI próprio

AudioProcessingBackgroundService                (SemaphoreSlim: Processing:MaxConcurrency)
  ├ ProcessingStatus = Processing
  ├ IFileStore.OpenReadAsync                     relê os bytes originais
  ├ FfmpegAudioCompressor                        transcodifica para AAC
  ├ IFileStore.SaveAsync                         grava o .m4a
  ├ StoredFileName/ContentType/SizeBytes/Url     passam a apontar para o .m4a
  ├ ProcessingStatus = Completed                 ← commit
  ├ IFileStore.DeleteAsync                       só depois do commit, apaga o original
  └ ISummaryQueue.TryEnqueue                    ─┐
                                                 │
      ⋮ thread de background #2                  │

AudioSummaryBackgroundService  ◄─────────────────┘   (SemaphoreSlim: Summarization:MaxConcurrency)
  └ SummaryStatus = Processing → Completed | Failed
```

---

## A medição

O "perceptível" do enunciado precisa ser número, não adjetivo. Mesmo arquivo, mesma máquina,
mesma build `Release`: um WAV de **4 minutos, 42.336.078 bytes (≈ 42 MB)**, gerado com
`ffmpeg -f lavfi -i "sine=frequency=440:duration=240"`.

`curl -w '%{time_total}'` no `POST /api/audios`, três execuções de cada lado:

| | run 1 | run 2 | run 3 | mediana |
|---|---|---|---|---|
| **Antes** (`main`, compressão dentro da requisição) | 3,145s | 2,927s | 2,833s | **2,927s** |
| **Depois** (compressão em background) | 0,303s | 0,124s | 0,214s | **0,214s** |

**≈ 14x mais rápido**, e a diferença é exatamente o `ffmpeg` que saiu de dentro da resposta.
Os logs da própria aplicação mostram de onde vem cada número:

```
# antes — o ffmpeg roda dentro da requisição
Áudio comprimido para AAC em 2838ms (entrada: 42336078 bytes, saída: 3882499 bytes, taxa: 128kbps)
Áudio armazenado: 69965c9f-1207-41d3-b1d4-db79a199e60a (bench.wav)

# depois — a resposta sai primeiro; o ffmpeg roda no worker
Áudio armazenado: abccf522-d9be-451a-b62e-a771f9ec4947 (bench.wav)
Áudio comprimido para AAC em 3213ms (entrada: 42336078 bytes, saída: 3882499 bytes, taxa: 128kbps)
Compressão de abccf522-d9be-451a-b62e-a771f9ec4947 concluída em 3302ms (3882499 bytes).
```

Dois detalhes honestos sobre essa tabela:

1. **O trabalho total não diminuiu.** O `ffmpeg` continua custando ~3 segundos; ele só deixou de
   ser cobrado do cliente. O que caiu 14x é a **latência da resposta**, que é exatamente o que o
   objetivo da atividade pede. O tempo até o `.m4a` existir continua sendo ~3s — agora
   observável em `ProcessingStatus` em vez de numa conexão pendurada.
2. **A compressão no worker aparece ~0,4s mais lenta** (3213ms contra 2838ms) porque as três
   requisições foram disparadas em sequência e os três `ffmpeg` acabaram rodando **em paralelo**,
   dividindo os mesmos núcleos. Isso é o `SemaphoreSlim` fazendo o seu trabalho: sem limite,
   uma rajada de uploads viraria uma rajada de `ffmpeg` competindo entre si e com o thread pool
   que atende HTTP.

A prova observável de que o trabalho saiu da requisição é a resposta do `POST`:

```jsonc
{
  "storedFileName": "abccf522d9be451ab62ea771f9ec4947.wav",  // ainda o original
  "contentType": "audio/wav",
  "sizeBytes": 42336078,
  "processingStatus": "Pending"                              // ninguém comprimiu nada ainda
}
```

e a mesma linha ~3,3s depois:

```jsonc
{
  "storedFileName": "abccf522d9be451ab62ea771f9ec4947.m4a",
  "contentType": "audio/mp4",
  "sizeBytes": 3882499,
  "processingStatus": "Completed"
}
```

---

## Por que a compressão precisou sair agora

A semana 2 concluiu "ainda não" para threading na compressão, e estava certa para o caso que
mediu. O que mudou não foi a arquitetura, foi a escala do pior caso.

`ffmpeg` custa aproximadamente **tempo linear no tamanho da entrada**:

| Entrada | Tempo de transcodificação | Fonte |
|---------|---------------------------|-------|
| 352 KB (11s de fala) | 160ms | medição da semana 3 |
| 42 MB (4min) | ~2,8s | medição desta semana |
| 50 MB (o limite de `Upload:MaxSizeBytes`) | ~3,4s | extrapolação |

Somados ao tempo de subida dos próprios 50 MB numa conexão doméstica, isso é uma requisição que
fica aberta segurando CPU que não tem nada a ver com receber o arquivo. E, diferente da
sumarização, **nada limitava quantos `ffmpeg` rodavam ao mesmo tempo**: N uploads simultâneos
eram N processos disputando os mesmos núcleos, cada um mais lento do que se tivessem sido
enfileirados. A fila não é só latência — é controle de recurso.

### `async/await` não resolvia isto

Vale repetir a distinção da semana 3, porque ela é a razão de o `await process.WaitForExitAsync`
que já existia não ter sido suficiente:

- `async/await` resolve **ocupação de thread**: enquanto o `ffmpeg` roda, a thread do ASP.NET
  Core volta para o pool. Isso já era verdade e continua sendo.
- `async/await` **não** resolve **latência de resposta**: `await` não faz a operação terminar
  antes. Se ela leva 3 segundos, o `await` leva 3 segundos.

O único jeito de a resposta sair antes do trabalho terminar é **desacoplar o trabalho da
requisição** — um produtor (o endpoint), um consumidor (o worker) e uma fila no meio.

---

## As primitivas de sincronização, e onde cada uma era necessária

### `Channel<Guid>` limitado — a fila (`ProcessingQueue`)

Mesma escolha e mesmas razões da `SummaryQueue`: fila produtor/consumidor da BCL, assíncrona,
thread-safe, sem dependência nova. **Limitada** (`CreateBounded`, capacidade 100) porque fila
ilimitada transforma rajada de upload em crescimento ilimitado de memória.
**`FullMode = DropWrite` + `TryEnqueue`**, nunca `await WriteAsync`: esperar por vaga colocaria a
lentidão de volta dentro da requisição, que é o problema que a mudança existe para resolver.
Fila cheia ⇒ o upload continua **201** e a linha fica `Failed` com o motivo explícito.

**Só o `Guid` atravessa a fila.** Nada de `Stream`, `DbContext` ou `HttpContext` — todos estariam
descartados quando o consumidor acordasse.

### Duas filas, não uma

Cada etapa tem um limite de concorrência **diferente e por motivos diferentes**:

| Fila | Recurso escasso | Limite padrão |
|------|-----------------|---------------|
| `ProcessingQueue` | núcleos **locais** da API (`ffmpeg` é CPU-bound, in-process) | `Environment.ProcessorCount` |
| `SummaryQueue` | a VPS remota de 4 vCPUs que hospeda o Whisper | 1 |

Uma fila só forçaria um limite comum, e ele estaria errado para as duas: 1 desperdiçaria os
núcleos locais, `ProcessorCount` atropelaria a VPS.

### `SemaphoreSlim` — os dois limites de concorrência

`SemaphoreSlim` é a primitiva certa aqui porque tem `WaitAsync`: esperar por vaga não queima uma
thread. Cada `BackgroundService` cria o seu, dimensionado pela sua opção, e o libera no `finally`
de `ProcessGuardedAsync` — inclusive quando o job falha.

### `SemaphoreSlim(1, 1)` — o `DbWriteGate`

Esta é a sincronização que **não existia antes desta semana e que a mudança tornou necessária**.

SQLite aceita **um escritor por vez**. Enquanto só havia o worker de resumo com
`MaxConcurrency = 1`, nunca havia duas escritas de background concorrentes. Agora há N
compressores mais o sumarizador, todos gravando transições de estado na mesma tabela:
`SQLite Error 5: 'database is locked'` deixou de ser hipótese.

`IDbWriteGate`/`DbWriteGate` é um singleton que serializa **só o `SaveChangesAsync`**:

```csharp
await _writeGate.WriteAsync(token => db.SaveChangesAsync(token), ct);
```

Três decisões deliberadas:

- **O gate roda o delegate; ele não entrega um token.** Não existe caminho em que um chamador
  esqueça de liberar o semáforo — o `Release()` está no `finally` do próprio gate.
- **O gate cobre a escrita, nunca o trabalho pesado.** `CompressToAacAsync`, `OpenReadAsync`,
  `SaveAsync`, `DeleteAsync` e a chamada HTTP ao Whisper ficam de fora. Segurar o semáforo
  durante a transcodificação anularia exatamente a concorrência que a fila acabou de criar.
- **O caminho da requisição não usa o gate.** `UploadAsync` faz um único `SaveChangesAsync`, e
  colocá-lo atrás do gate devolveria uma espera para dentro da thread da requisição.

### Ordem de commit: a linha nunca aponta para um arquivo que não existe

A ordem entre gravar o `.m4a`, atualizar a linha e apagar o original **é** um problema de
sincronização, e a primeira versão errou. Apagar o original antes do commit abre uma janela em
que a linha ainda diz `.wav`, o arquivo `.wav` já não existe, e um
`GET /api/audios/{id}/download` naquele instante responde 404.

Isso apareceu como um teste intermitente (≈1 falha em 10 execuções), não como um bug reportado —
que é justamente o valor de ter um teste que exerce a janela de propósito. A ordem correta é:
grava o `.m4a` → atualiza e **commita** a linha → só então apaga o original. A invariante que se
quer preservar é simples de enunciar: **o arquivo apontado pela linha existe em todo instante.**

### Escopo de DI por job

`AppDbContext` é `scoped` e não é thread-safe; o escopo da requisição que enfileirou já morreu
quando o worker acorda. Cada job resolve o seu próprio escopo por `IServiceScopeFactory`.

### Uma falha de job nunca derruba o loop

Se uma exceção escapasse do `ExecuteAsync`, o `BackgroundService` pararia e a fila inteira
morreria em silêncio pelo resto da vida do processo. Cada job roda dentro de
`ProcessGuardedAsync`; o erro é logado, gravado na linha e o loop segue.

### Resumo das escolhas

| Escolha | Alternativa rejeitada | Por quê |
|---------|----------------------|---------|
| Duas filas | Uma fila com tipo de job | Limites de concorrência diferentes por recurso escasso diferente |
| Guardar o original e substituir pelo `.m4a` | Segurar os bytes em memória até comprimir | 50 MB por upload vezes a fila é o estouro que a fila limitada existe para evitar |
| `SemaphoreSlim(ProcessorCount)` na compressão | Concorrência ilimitada | Mais `ffmpeg` que núcleos deixa todos mais lentos e compete com o thread pool do HTTP |
| `DbWriteGate` com `SemaphoreSlim(1,1)` | Retry em `SQLITE_BUSY` | Serializar é mais barato e determinístico que descobrir o erro e tentar de novo |
| Commit antes do delete | Delete antes do commit | A linha nunca pode apontar para um arquivo inexistente |
| `BackgroundService` | `Task.Run` / `new Thread` | Ciclo de vida do host, `stoppingToken`, shutdown limpo |

---

## O que a mudança custou: o 422 acabou

`POST /api/audios` **não devolve mais 422**. A requisição não decodifica mais nada, então não
tem como saber se o arquivo é decodificável. Falha de decodificação virou
`ProcessingStatus = Failed` + `ProcessingError` na linha — o mesmo tratamento que a semana 3 deu
para falha de sumarização, e pela mesma razão.

O 400 continua igual: `AudioFileValidator` é pré-voo (nome, content-type, tamanho) e não decodifica
nada, então continua dentro da requisição.

Isso mudou o comportamento observável de dois testes, que passaram a esperar o pipeline em vez de
esperar a resposta. Nenhum outro teste da suíte foi tocado — os 55 continuam verdes.

---

## O cliente: cada áudio processado mostra o seu resumo

A tela passou a ter uma segunda região abaixo do thread: **Áudios processados**, alimentada por
`GET /api/audios` (endpoint que existia desde a semana 1 e nunca tinha sido consumido).

Cada item mostra nome do arquivo, tamanho, formato, data, um chip de estado e — o ponto da
atividade — **o resumo do áudio**. Um item sem resumo nunca fica vazio: ele mostra o motivo.

| Estado do item | O que aparece |
|----------------|---------------|
| `processingStatus` `Pending`/`Processing` | "Na fila para compressão" / "Comprimindo o áudio no servidor…" |
| `processingStatus` `Failed` | "Não foi possível comprimir este áudio" + o `processingError` |
| `summaryStatus` `Pending`/`Processing` | "Na fila para transcrição" / "Transcrevendo com Whisper tiny…" |
| `summaryStatus` `Completed` | **o texto do resumo** + idioma + `N / 500 caracteres` |
| `summaryStatus` `Failed` | "Não foi possível resumir este áudio" + o `summaryError` |
| `summaryStatus` `Disabled` | "Resumo desativado no servidor. O áudio foi armazenado." — neutro, nunca vermelho |

A compressão tem precedência sobre a sumarização na escolha do estado: enquanto o `ffmpeg` roda
não existe `.m4a` para resumir, então dizer "resumindo" seria mentira.

A lista faz polling **só enquanto houver item não-terminal** e para sozinha quando todos estiverem
terminais. Todo valor visual resolve para um token de [`docs/DESIGN.md`](DESIGN.md), que ganhou
nesta semana as entradas de `{component.processed-*}` e dois chips novos.

---

## O que **não** foi feito (e o gatilho para fazer)

Fora de escopo de propósito, para manter o diff honesto:

- **Persistência da fila.** Se o processo cai, os jobs `Pending` em memória se perdem e a linha
  fica `Pending` para sempre — agora em **duas** filas em vez de uma. *Gatilho: quando perder um
  job passar a importar; a correção é varrer `Pending` antigos no startup e reenfileirar.*
- **Retentativa com backoff.** Um `Failed` continua `Failed`. Reenviar o áudio é a alternativa.
- **Reprocessar um áudio da lista.** Não existe endpoint para isso, e o navegador não tem mais o
  arquivo em mãos — por isso os itens com falha na lista **não** têm botão de "Tentar novamente":
  seria um botão que promete o que o sistema não faz.
- **Paginação, ordenação e filtro da lista.** `GET /api/audios` devolve tudo.
- **Fila distribuída / múltiplas instâncias.** Com duas instâncias, cada uma teria a sua fila em
  memória, o `SemaphoreSlim` deixaria de limitar o total e o `DbWriteGate` deixaria de serializar
  as escritas — SQLite com dois processos precisaria de outra estratégia. *Gatilho: escalar
  horizontalmente.*

---

## Configuração

`appsettings.json`, seção nova:

```jsonc
{
  "Processing": {
    "MaxConcurrency": 0,        // 0 = número de processadores da máquina
    "QueueCapacity": 100        // fila cheia → ProcessingStatus Failed, upload segue 201
  }
}
```

`Processing:MaxConcurrency` é `int?` justamente para que a chave possa aparecer no arquivo sem
congelar o valor: **ausente, nulo ou ≤ 0 significa `Environment.ProcessorCount`**, resolvido em
`ProcessingOptions.EffectiveMaxConcurrency`. O valor certo depende do host, não do arquivo de
configuração — um literal aqui daria o mesmo número numa máquina de 2 e numa de 32 núcleos.
Defina um número positivo só para forçar um valor (os testes fazem isso, via
`Processing__MaxConcurrency`, para não depender do número de núcleos do runner de CI).

> **Atenção ao banco existente:** o schema é criado com `EnsureCreated()` e o projeto não usa
> migrations. As colunas novas (`ProcessingStatus`, `ProcessingError`, `ProcessingUpdatedAtUtc`)
> **não** são adicionadas a um `data/audios.db` que já existe — o app quebra com
> `SQLite Error 1: 'no such column: a.ProcessingStatus'`. Apague o arquivo
> (`rm src/AudioApi/data/audios.db`) **e** o volume `audio-data` do compose
> (`docker compose down -v`) antes de subir.
