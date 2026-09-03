# MR — Atividade #1: baseline sequencial e benchmark do pipeline de áudio

## Resumo

Este MR cria versões sequenciais, selecionáveis por configuração, das funcionalidades do projeto
final e mede-as contra o estado otimizado/paralelo:

- a API usa `Processing:ExecutionMode=Parallel` por padrão e oferece `Sequential`, que processa
  um job por vez sem alterar o contrato de upload, persistência ou falhas;
- o worker de sumarização aceita o mesmo modo para uma baseline serial isolada;
- o cliente usa Web Worker por padrão e oferece `NEXT_PUBLIC_AUDIO_VALIDATION_MODE=sequential`,
  mantendo o núcleo síncrono de validação compartilhado;
- um harness reproduzível gera CSVs com p50/p95/máxima do POST, makespan, throughput, estados,
  status HTTP, fixture e critério de aprovação;
- o relatório apresenta tabelas, gráficos, percentuais de economia, análise e limitações.

## Evidências

Relatório principal: [`activity-1-sequential-vs-parallel-benchmark.md`](activity-1-sequential-vs-parallel-benchmark.md).

Dados brutos:

- [`api-sequential-vs-parallel.csv`](benchmarks/api-sequential-vs-parallel.csv): 24 amostras,
  workload curto de 1 s, 1/2/4/8 usuários;
- [`api-sequential-vs-parallel-heavy.csv`](benchmarks/api-sequential-vs-parallel-heavy.csv):
  30 amostras, workload de 10 s, 1/2/4/8/16 usuários;
- [`client-validation.json`](benchmarks/client-validation.json): núcleo headless e coleta real
  em Edge da página `/benchmark`.

Resultado representativo: no workload pesado com 16 usuários, o makespan mediano caiu de
2.355,617 ms (sequencial) para 1.639,768 ms (paralelo), economia de 30,40%; o throughput subiu
de 6,792 para 9,757 jobs/s (+43,65%). Em 8 usuários a economia foi -0,29%, por isso o MR não
afirma ganho universal nem aumento de capacidade.

## Test plan

### Automatizado

- [x] `dotnet test --nologo` — 68 testes aprovados
- [x] `npm --prefix web run test:run` — 142 testes aprovados em 11 arquivos
- [x] `npm --prefix web run typecheck`
- [x] `npm --prefix web run build` — compilação Next concluída; rotas `/` e `/benchmark` estáticas
- [x] `npm --prefix web run benchmark:client` — 1 benchmark aprovado
- [x] `bash -n scripts/activity-1-sequential-benchmark.sh`
- [x] `git diff --check`

### Benchmark da API

~~~bash
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
~~~

### Verificação manual do cliente

1. Subir `web` com `npm run dev`.
2. Abrir `/benchmark` e executar a medição em browser Chromium/Edge.
3. Confirmar que o JSON informa 12 validações seriais por modo, o Worker real e o atraso do
   timer/event loop.
4. Confirmar que o fluxo normal continua validando antes do POST e que o modo padrão é paralelo.

## Riscos e limitações

- ffmpeg e SQLite são gargalos compartilhados; aumentar concorrência pode piorar cargas curtas.
- O benchmark do servidor não determina capacidade máxima porque nenhuma rodada saturou a fila.
- O validador do cliente lê apenas 16 bytes; o Worker real tem custo fixo e não apresentou economia
  de tempo neste workload. O headless Worker double não é usado como prova de paralelismo.
- Whisper foi desligado na comparação da API; sumarização exige benchmark separado com modelo e
  worker fixos.
