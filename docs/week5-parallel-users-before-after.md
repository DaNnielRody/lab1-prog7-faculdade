# Usuários simultâneos — Antes vs Depois

## Resultado

No mesmo host, com build Release, `Processing:MaxConcurrency=4`, sumarização desligada e a
mesma fixture, os dois cenários tiveram o mesmo limite observado:

| Cenário | Maior nível aprovado | Primeiro nível reprovado | Intervalo estimado |
| --- | ---: | ---: | --- |
| Antes — `9817eb4`, tasks + `SemaphoreSlim` | 256 | 512 | ≥ 256 e < 512 |
| Depois — `253dd35`, `Parallel.ForEachAsync` + políticas deste PR | 256 | 512 | ≥ 256 e < 512 |

O nível 512 reprovou nas cinco amostras e em uma sexta repetição confirmatória para cada fonte.
Logo, **não houve ganho mensurável de capacidade** (`256 → 256`). Diferenças de latência e
throughput dentro de um mesmo nível não autorizam alegar aumento de capacidade.

## Critério e método

- Um usuário simultâneo é um cliente que envia um WAV e aguarda `Completed` ou `Failed`.
- Uma rodada aprova somente com todos os uploads em HTTP 201, todos em `Completed`, zero
  `Failed`, `Pending`, `Processing`, ausentes, rejeições de overload ou descartes no deadline, e
  p95 do POST ≤ 2.000 ms.
- O deadline de 30 s nasce uma vez no começo da rodada e é compartilhado por todos os pollings.
- Foram executadas cinco rodadas válidas por nível em `1, 2, 4, 8, 16, 32, 64, 128, 256,
  512`; o nível reprovado recebeu uma sexta confirmação.
- A ordem Antes/Depois foi alternada nas cinco amostras. Cada amostra iniciou um processo, banco
  SQLite e file store novos, fez um upload de warm-up fora do CSV e só então iniciou a medição.
- Ambos foram publicados em Release no mesmo host e usaram o mesmo WAV de 4.078 bytes, SHA-256
  `70a2a33ece807a4cbea52d2ab4c8e5127f0e9919ef77ea652b718d343127d1cc`.
- `Processing:MaxConcurrency=4` foi idêntico. A fila teve capacidade 256 até esse nível e 512 na
  extensão final: suficiente para todos os produtores, sem transformar a comparação principal em
  teste de overload.
- A sumarização permaneceu desabilitada. Rejeições HTTP 429/503 são contabilizadas como
  reprovação, nunca como sucesso.

## Medições

Valores são medianas das rodadas. Latências e makespan estão em milissegundos. O CSV bruto contém
p50/p95 individual, todos os status HTTP, estados finais, falhas, pendências, observabilidade de
descarte e jobs/s. Como nenhuma fonte exporta contador de drops, a coluna registra honestamente
`not-instrumented`; terminalidade e pendências são observadas separadamente.

| Usuários | Antes POST p50/p95 | Depois POST p50/p95 | Antes makespan / jobs/s | Depois makespan / jobs/s | Rodadas aprovadas |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 10,8 / 10,8 | 11,4 / 11,4 | 141,5 / 7,07 | 142,3 / 7,03 | 5/5; 5/5 |
| 2 | 10,9 / 161,4 | 9,9 / 162,2 | 293,4 / 6,82 | 300,7 / 6,65 | 5/5; 5/5 |
| 4 | 160,7 / 461,9 | 162,5 / 463,1 | 594,7 / 6,73 | 595,1 / 6,72 | 5/5; 5/5 |
| 8 | 462,0 / 1.062,7 | 461,7 / 1.062,1 | 1.197,6 / 6,68 | 1.196,6 / 6,69 | 5/5; 5/5 |
| 16 | 312,9 / 1.213,3 | 316,2 / 1.365,7 | 1.358,2 / 11,78 | 1.514,0 / 10,57 | 5/5; 5/5 |
| 32 | 57,8 / 624,2 | 60,2 / 632,9 | 1.131,3 / 28,29 | 1.243,3 / 25,74 | 5/5; 5/5 |
| 64 | 146,6 / 479,0 | 157,0 / 495,6 | 1.641,7 / 38,98 | 1.314,6 / 48,69 | 5/5; 5/5 |
| 128 | 408,5 / 502,1 | 371,6 / 499,1 | 3.385,6 / 37,81 | 3.530,9 / 36,25 | 5/5; 5/5 |
| 256 | 670,8 / 862,7 | 743,3 / 931,2 | 14.948,6 / 17,13 | 12.814,6 / 19,98 | 5/5; 5/5 |
| 512 | 1.402,9 / 2.076,8 | 1.525,5 / 1.835,7 | 29.696,7 / 9,70 | 29.878,0 / 8,43 | 0/6; 0/6 |

Em 512, todos os 6.144 POSTs somados foram admitidos com 201 e não houve `Failed`, 429, 503 ou
descarte observável. Ao fim dos deadlines, o Antes somou 1.703 `Completed`, 1.348 `Pending` e 21
`Processing`; o Depois, 1.520 `Completed`, 1.521 `Pending` e 31 `Processing`. Isso caracteriza
limite de processamento/deadline, não limite de admissão da fila. Os valores não monotônicos em
níveis menores reforçam que esta fixture curta é sensível ao agendamento de processos e ao SQLite.

## Limites diferentes que não devem ser confundidos

- **Processos de compressão:** no máximo 4 ffmpeg simultâneos nos dois cenários.
- **Admissão:** 256 slots nos níveis até 256 e 512 slots no nível 512; nenhuma rodada saturou a
  fila. Descarte direto não era instrumentado; a evidência observável foi 100% terminal até 256.
- **Throughput:** no maior nível aprovado, mediana de 17,13 jobs/s Antes e 19,98 jobs/s Depois.
- **Latência POST:** no maior nível aprovado, p95 mediano de 862,7 ms Antes e 931,2 ms Depois.
- **Capacidade pelo SLA completo:** maior aprovado 256, primeiro reprovado 512 em ambos.

## Reprodução e dados brutos

O script reproduzível é
[`scripts/activity-1-week-6-parallel-audio-benchmark.sh`](../scripts/activity-1-week-6-parallel-audio-benchmark.sh).
O artifact durável com 102 linhas de dados é
[`docs/benchmarks/parallel-audio-capacity.csv`](benchmarks/parallel-audio-capacity.csv).

```bash
# Escada principal (cria o CSV)
scripts/activity-1-week-6-parallel-audio-benchmark.sh \
  --before-ref 9817eb4 --after-source "$PWD" \
  --before-label manual-tasks --after-label parallel-consistent \
  --output docs/benchmarks/parallel-audio-capacity.csv \
  --rounds 5 --max-users 256 --queue-capacity 256 \
  --max-concurrency 4 --post-sla-ms 2000 \
  --terminal-deadline-seconds 30 --port 51819

# Extensão do teto e confirmação automática (anexa 512)
scripts/activity-1-week-6-parallel-audio-benchmark.sh \
  --before-ref 9817eb4 --after-source "$PWD" \
  --before-label manual-tasks --after-label parallel-consistent \
  --output docs/benchmarks/parallel-audio-capacity.csv \
  --rounds 5 --start-users 512 --max-users 512 --append \
  --queue-capacity 512 --max-concurrency 4 --post-sla-ms 2000 \
  --terminal-deadline-seconds 30 --port 51819
```

## Ambiente e limitações

Host: AMD Ryzen 5 8600G, 6 cores/12 threads, 14 GiB RAM, Linux 7.0.0-28, .NET SDK 10.0.110 e
ffmpeg 6.1.1. A máquina não foi isolada de todos os demais processos.

Esta evidência usa um WAV de apenas 0,25 s e 4.078 bytes, ffmpeg local e SQLite; não cobre áudio
próximo do máximo de 50 MB, outros codecs/durações, sumarização Whisper, rede externa, múltiplas
instâncias ou outro hardware. A fila em memória ainda depende da recuperação no startup após uma
parada. O intervalo é específico ao SLA e workload declarados, não um teto universal do hardware.
