# Semana 7 — Filtro de áudio no servidor e barra de prévia no cliente

## O que foi implementado

O servidor passou a **derivar um segundo áudio** de cada upload. Depois que a compressão AAC
termina e é comitada, o mesmo job aplica uma cadeia de filtros do `ffmpeg` — realce de voz — sobre
o áudio já comprimido e **salva o resultado no file store como um arquivo extra do mesmo id**
(`{id:N}.filtered.m4a`). O áudio comprimido continua sendo o que `GET /download` devolve; o
filtrado nunca o substitui.

O cliente passou a **reproduzir os dois**. Cada item de áudio já processado na conversa ganhou uma
barra de prévia com play/pause, tempo decorrido, duração, a waveform existente e um seletor entre
duas faixas: **Original** — o que a API serve hoje — e **Com filtro**.

Nenhum contrato anterior mudou: upload, download, status e resumo respondem exatamente como antes,
e nenhum campo existente do DTO foi alterado.

### Requisitos da atividade → onde está

| Requisito | Onde |
| --- | --- |
| Aplicar um filtro de áudio (servidor) | `src/AudioApi/Compression/FfmpegAudioFilter.cs` — cadeia configurável via `AudioFilter:FilterChain` |
| Salvar o áudio filtrado no file store | `AudioProcessingBackgroundService.ApplyFilterAsync` → `IFileStore.SaveAsync` com a extensão de variante `.filtered.m4a` |
| Expor o resultado | `GET /api/audios/{id}/download/filtered` e os cinco campos novos de `AudioFileDto` |
| Barra de prévia em cada item processado (cliente) | `web/components/transcription/PreviewBar.tsx`, montada por `Thread.tsx` |
| Reproduzir o áudio original | faixa "Original" → `audio.url` |
| Reproduzir o áudio extra com filtros | faixa "Com filtro" → `audio.filteredUrl` |
| Não quebrar os testes anteriores | 81 testes de backend (eram 70) e 163 de frontend, nenhuma asserção anterior enfraquecida |

## A pergunta que precisou ser respondida antes de codar: o que é o "original"?

A compressão **substitui e apaga** o upload cru. Depois que um job termina, os bytes que o usuário
enviou não existem mais em lugar nenhum — a linha aponta para o `.m4a`, e o arquivo anterior foi
removido logo após o commit. Então "reproduzir o áudio original" tinha duas leituras incompatíveis,
e escolher errado custaria caro nos dois sentidos.

| Leitura | O que exigiria | Por que não / por que sim |
| --- | --- | --- |
| **Preservar o upload cru** | parar de apagar o arquivo anterior; passar a guardar 3 arquivos por áudio | Muda o ciclo de vida do arquivo que já estava estabelecido e triplica o armazenamento por um requisito que não pediu isso |
| **"Original" = o áudio atual** ✅ | nada além do arquivo filtrado novo | O que `GET /download` devolve **é** o áudio do usuário, na forma canônica do sistema; o filtrado é o "extra" que o enunciado descreve |

A segunda foi escolhida — decisão de produto, levada ao humano no grill e confirmada por ele. Está
registrada em `.claude/contexts/audio-api/CONTEXT.md` para que a próxima atividade não a
redescubra.

## Qual filtro, e por quê

`highpass=f=200,lowpass=f=3000,dynaudnorm` — realce de voz.

O domínio deste projeto é **transcrição de fala**. Um passa-alta em 200 Hz derruba ruído de fundo,
zumbido de rede elétrica e retumbo; um passa-baixa em 3 kHz corta acima da banda útil da voz; a
normalização de dinâmica equaliza trechos falados alto e baixo. É audível na prévia e é coerente
com o que o resto do pipeline faz.

A alternativa considerada era um efeito evidente (eco/reverb): a diferença seria mais dramática na
demonstração, mas não teria relação nenhuma com o domínio. A cadeia é configurável, então trocá-la
não exige recompilar.

## Onde o filtro roda, e por que ali

Dentro do **job de compressão que já existe**, depois do commit que marca `ProcessingStatus.Completed`
e da remoção do arquivo original.

| Alternativa | Por que não |
| --- | --- |
| Dentro do `POST` | O requisito da disciplina é aumentar o processamento **fora** da requisição; seria desfazer o trabalho das semanas 3 e 4 |
| Uma terceira fila, como a de resumo | Custo real: mais uma fila, mais um hosted service, mais um estado de admissão — para um passo que depende do arquivo que a compressão **acabou** de produzir |
| Antes da compressão | Filtrar o upload cru e depois comprimir gastaria duas passagens de `ffmpeg` sobre o arquivo maior |

A escolha tem um preço honesto: cada worker paralelo fica ocupado por mais tempo, porque agora roda
duas invocações de `ffmpeg` em vez de uma. Isso é exatamente o "aumento no uso de processamento"
que a atividade pediu, mas significa que a capacidade simultânea medida na semana 5 não vale mais
sem nova medição.

## A invariante que custou uma correção do conclave

**Um extra derivado não pode destruir o resultado primário.**

O passo de filtro começou isolando só as falhas previstas — `ffmpeg` com código não zero, arquivo
sumido, I/O. Qualquer outra exceção escapava. Na prática a realista é `DbUpdateException` em um dos
dois commits do filtro: ela subia até o handler fatal do worker, que marcava um áudio **já
comprimido e já `Completed`** como `Failed`, falhava também o resumo dele, e derrubava o host.

Ou seja: uma falha ao gerar um arquivo acessório apagava um trabalho que tinha dado certo e parava
a fila inteira. Isso contradizia a própria especificação, que diz que uma falha do filtro nunca
reprova a compressão nem o resumo.

Agora o passo inteiro é isolado: **toda** exceção que não seja cancelamento vira `FilterStatus.Failed`
e mais nada. O cancelamento continua propagando, para que o shutdown do host siga sendo tratado
como antes. O teste
`FilterFailure_OutsideKnownTaxonomy_DoesNotRegressCompression_AndWorkerSurvives` prova as duas
metades: o áudio continua `Completed`, e um **segundo upload no mesmo host** ainda é processado —
que é a única forma de demonstrar que o worker não morreu.

A troca embutida nessa decisão: um bug de programação dentro do filtro agora aparece como
`FilterStatus.Failed` e um log `Critical`, em vez de falhar ruidosamente. Preferiu-se isso a deixar
um acessório derrubar o principal.

## A terceira máquina de estados

`FilterStatus` espelha as duas que já existiam — `Pending → Processing → Completed | Failed` — e o
espelhamento **não é decorativo**: o estado `Processing` é o que permite distinguir um filtro
interrompido de um que nunca começou.

Sem ele, uma linha parada em `Pending` podia significar as duas coisas, e a recuperação de startup
não tinha como escolher. Com ele, `RecoverUnfinishedJobsAsync` readmite qualquer linha em `Pending`
ou `Processing` cujo processamento já esteja `Completed`, e **re-executa apenas o filtro** — nunca
uma recompressão inteira.

Uma falha de compressão terminaliza o filtro pelo mesmo motivo: sem `.m4a`, nunca haverá o que
filtrar.

## O cliente: uma barra por item, não um segundo player

O rodapé já tem um player, mas ele toca o **arquivo local selecionado** — não serve para um áudio
que já está no servidor. A barra nova é um irmão compacto dele, dentro da mensagem de cada áudio
processado.

| Estado do filtro no servidor | O que a barra mostra |
| --- | --- |
| `Completed` | as duas faixas selecionáveis |
| `Pending` / `Processing` | "Com filtro" desabilitada, com o motivo visível |
| `Failed` | "Com filtro" desabilitada, com o erro do servidor visível |

A regra por trás da tabela: **nunca um controle morto**. Uma opção que não faz nada ao ser clicada
é pior do que uma opção visivelmente indisponível com o motivo escrito ao lado.

Acessibilidade: o seletor é um `radiogroup` de verdade (`aria-checked`, `aria-disabled`,
`aria-describedby` apontando para o motivo, navegação por setas), e o transporte fica dentro de uma
região `aria-live="off"` — a conversa é um `role="log"` com `aria-live="polite"`, e sem isso cada
atualização de segundo do tempo decorrido seria anunciada por leitor de tela.

O componente e todos os seus estados estão especificados em
[`docs/DESIGN.md`](DESIGN.md) como `{component.preview-bar}` e `{component.track-selector}`, com
todo valor visual resolvendo para um token já existente.

## O gate que não existia

Três skills do pipeline e o passo 7 do próprio orquestrador mandavam rodar
`docker compose --profile client build frontend-build` como portão do cliente. **Esse serviço não
existia** — nem ele, nem o stage `client-build` no `Dockerfile.sandbox`, nem o profile `client`.

Toda execução anterior que declarou esse portão verde declarou algo que nunca rodou. Ele foi
construído nesta entrega: stage não-root (uid 1001, com `/app/web` já pertencendo a esse uid antes
do `npm ci`), Node fixado na mesma versão que a CI usa, rodando testes, typecheck e build do
cliente dentro do container. Não substitui a CI, que continua rodando os mesmos comandos
diretamente.

## Verificação

```bash
# backend, isolado
docker compose -f docker-compose.dark-factory.yml up unit-tests --build \
  --abort-on-container-exit --exit-code-from unit-tests

# cliente, isolado
docker compose -f docker-compose.dark-factory.yml --profile client build frontend-build
```

| Portão | Resultado |
| --- | --- |
| Backend (xUnit, sandbox) | **81 passaram, 0 falharam** — eram 70 antes desta entrega |
| Cliente (Vitest + typecheck + build, sandbox) | **163 testes**, typecheck limpo, build ok |
| Design | **GREEN** — `block:0 high:0 medium:0 nit:0` |
| CI (GitHub Actions) | verde |

## O que **não** foi validado

Declarado aqui pelo mesmo motivo que nas semanas anteriores: um número sem ressalva é uma
afirmação maior do que a medição sustenta.

- **A composição worker + `ffmpeg` real nunca foi observada ponta a ponta.** O teste unitário do
  filtro usa o binário de verdade; os testes de integração substituem `IAudioFilter` por um duplo
  controlado. Os dois caminhos são testados, o encontro deles não.
- **Ninguém verificou que o áudio filtrado soa diferente.** Os testes provam que ele existe, é
  `audio/mp4` e tem bytes — não que a cadeia de filtros produziu o efeito pretendido.
- **A capacidade simultânea da semana 5 não vale mais.** Cada job agora roda duas invocações de
  `ffmpeg`. O impacto não foi medido.
- **A recuperação de filtro roda em série antes do consumo da fila.** Um backlog grande de linhas
  não filtradas atrasa o início do trabalho novo. A forma serial espelha a recuperação de
  compressão que já existia; nenhum backlog foi medido.
- **A barra de prévia nunca rodou num navegador real** — só em jsdom. Reprodução, duração e o
  comportamento do elemento `<audio>` em Safari e Firefox não foram observados.
- **`EnsureCreated` não altera bancos existentes.** Um `data/audios.db` anterior a esta entrega não
  ganha as colunas de filtro; apagá-lo é o procedimento já usado no repositório, como foi com as
  colunas de resumo.
