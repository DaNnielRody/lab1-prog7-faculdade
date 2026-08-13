# Usuários simultâneos — Antes vs Depois

## Resultado

O maior nível testado em que todos os uploads receberam `201 Created`, todos os
processamentos terminaram como `Completed` dentro do deadline e o p95 do POST
ficou dentro do SLA foi:

| Cenário | Maior nível testado aprovado |
| --- | ---: |
| Antes — `9817eb4`, worker com tasks + `SemaphoreSlim` | 8 usuários |
| Depois — working tree, worker com `Parallel.ForEachAsync` | 8 usuários |

Neste host e neste workload, a API demonstrou atender pelo menos 8 usuários nos
dois cenários (`8 → 8` na matriz executada). O benchmark não buscou o ponto de
falha acima de 8; portanto, 8 não é chamado de capacidade máxima nem de teto do
hardware. A troca para `Parallel.ForEachAsync` não é apresentada como ganho.

## Metodologia

- **Usuário simultâneo:** um upload HTTP concorrente. Um nível passa somente se
  todos os uploads receberem `201`, todos chegarem a `Completed` em até 30 s e
  o p95 do tempo de POST for no máximo 2.000 ms.
- **Matriz:** 3 rodadas por cenário e por nível: 1, 2, 4 e 8 uploads
  simultâneos.
- **Configuração:** `Processing__MaxConcurrency=4` nos dois cenários; a escada
  de 1/2/4/8 é o número de usuários, não uma configuração artificial de
  paralelismo.
- **Fixture:** WAV curto de 4.078 bytes, SHA-256
  `70a2a33ece807a4cbea52d2ab4c8e5127f0e9919ef77ea652b718d343127d1cc`.
- **Warm-up:** um upload antes das rodadas, excluído dos resultados.
- **Transporte:** API HTTP real em `127.0.0.1`, build `Release`, banco SQLite e
  file store temporários por execução.

## Medições

Valores abaixo são as medianas das 3 rodadas. Os tempos estão em milissegundos;
“terminal” é o tempo total observado do início da rodada até todos os estados
terminais.

| Usuários | Antes p95 POST | Depois p95 POST | Antes terminal | Depois terminal | Rodadas aprovadas |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9.045 | 9.913 | 134.999 | 136.038 | 3/3 — `true` |
| 2 | 159.141 | 158.680 | 285.295 | 284.608 | 3/3 — `true` |
| 4 | 460.962 | 458.617 | 590.121 | 588.161 | 3/3 — `true` |
| 8 | 1059.525 | 1059.145 | 1196.106 | 1196.231 | 3/3 — `true` |

Resultado bruto: 24 linhas de dados (12 por cenário); todas tiveram
`post_201_count == users`, `terminal_count == users`,
`completed_count == users`, `failed_count == 0` e `criterion_pass=true`.

## Ambiente

Ryzen 5 8600G, 12 processadores lógicos, 14 GiB RAM, Ubuntu 24.04.4,
.NET SDK 10.0.110 e ffmpeg 6.1.1.

## Reprodução

Na raiz do repositório:

```bash
scripts/activity-1-week-6-parallel-audio-benchmark.sh \
  --before-ref 9817eb4 \
  --after-source "$PWD" \
  --before-label manual-tasks \
  --after-label parallel-foreach \
  --output /tmp/activity-1-week-6-parallel-audio-results.csv \
  --rounds 3 \
  --levels 1,2,4,8 \
  --max-concurrency 4 \
  --post-sla-ms 2000 \
  --terminal-deadline-seconds 30 \
  --port 51819
```

O CSV utilizado foi `/tmp/activity-1-week-6-parallel-audio-results.csv`.
O cenário Depois foi executado a partir do working tree em
`9817eb443bc934307de57221696fb0d89294f2fe+working-tree`; após o commit, este
identificador deve ser atualizado para o SHA final da entrega.

## Conclusão e limitações

O benchmark demonstra que a API continua atendendo pelo menos 8 uploads simultâneos sob
os critérios definidos após a troca do mecanismo de orquestração. O benchmark não demonstra
ganho universal nem compara contra a versão síncrona histórica: o
“Antes” medido aqui é o `main` em `9817eb4`, que já usava processamento em
background com tasks e `SemaphoreSlim`. O maior nível testado foi somente 8 usuários,
a fixture é curta, a medição foi feita em uma única máquina e o resultado pode
variar com CPU, ffmpeg, SQLite, disco e carga do host.
