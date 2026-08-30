# Semana 6 — Validação paralela de áudio no cliente

## O que foi implementado

O cliente passou a **decidir se o arquivo é um áudio aceitável antes de existir qualquer
requisição**. Selecionar (ou arrastar) um arquivo dispara a validação em um **Web Worker
dedicado**: extensão, MIME type correspondente, arquivo não vazio, teto de 50 MB e **assinatura do
conteúdo** (magic bytes). Enquanto a validação roda, o envio fica indisponível; se ela reprovar, o
arquivo **não sai do navegador** e a interface diz o motivo.

A lista de áudios já enviados continua na conversa e passou a **refletir o novo envio no instante
em que o `POST` é aceito**, sem esperar o próximo `GET /api/audios`.

O trabalho de rede e o pipeline do servidor não mudaram: a validação da API permanece como segunda
camada, e nenhum limite de fila, concorrência ou capacidade do backend foi tocado.

### Requisitos da atividade → onde está

| Requisito | Onde |
| --- | --- |
| Exibir a lista de arquivos de áudio enviados | `web/lib/useProcessedAudios.ts`, `web/app/page.tsx` (histórico na conversa, os 10 mais recentes) |
| Atualizar a lista após um novo envio | `useProcessedAudios(phase, acceptedAudio)` — insere o DTO do `POST` e reconcilia com o `GET` |
| Validar o áudio antes de enviá-lo | `web/lib/audioValidation.ts` (regras puras) |
| Bloquear ou sinalizar arquivos inválidos | `canUpload` em `web/lib/useTranscription.ts`, CTA e mensagem em `SettingsPanel.tsx`, confirmação em `UploadDialog.tsx` |
| Programação paralela no frontend | `web/workers/audioValidation.worker.ts` + `web/lib/audioValidationClient.ts` (Worker, com fallback assíncrono) |
| Manter o fluxo de envio funcionando | `POST` → polling → resumo inalterados; 139 testes de frontend verdes |
| Preservar testes anteriores | nenhuma asserção anterior alterada; 67 testes de backend e 139 de frontend |

## Por que Worker, e não só `async/await`

Ler os primeiros bytes de um `File` já é assíncrono (`Blob.arrayBuffer`), então seria possível
validar sem Worker. Isso resolveria o *I/O*, não o requisito: `async/await` é **concorrência em uma
thread só** — a comparação de assinatura, o `slice` e qualquer trabalho de CPU continuam
disputando a mesma thread que pinta a interface. O requisito da semana é **paralelismo no
cliente**, e no navegador a única primitiva que dá uma thread de verdade é o **Web Worker**.

A escolha também é a correta pelo custo: o teto de upload é 50 MB, e a decisão precisa acontecer
entre a seleção do arquivo e o clique de confirmação — exatamente o intervalo em que travar a
thread principal apareceria como interface congelada.

| Alternativa | Por que não |
| --- | --- |
| Validar dentro do `POST` (só no servidor) | O arquivo inválido sobe 50 MB para ser rejeitado depois; o requisito é bloquear **antes** do upload |
| `accept` do `<input>` | É dica para o seletor de arquivos, não decisão: não vale para drag-and-drop, não olha tamanho nem conteúdo |
| Só `async/await` na thread principal | Não é paralelismo; o trabalho de CPU continua no caminho da renderização |
| `Worker` compartilhado/pool | Um arquivo por vez é o modelo da tela; um pool seria concorrência sem demanda |

## O que é verificado

`web/lib/audioValidation.ts` — regras puras, sem DOM, testáveis isoladamente e reutilizadas pelo
Worker e pelo fallback.

| Ordem | Regra | Por que nesta posição |
| --- | --- | --- |
| 1 | Extensão em `.mp3 .wav .ogg .flac .m4a .aac .webm` | É a checagem mais barata e define qual assinatura esperar |
| 2 | MIME type compatível com a extensão | `.mp3` marcado como `audio/ogg` é inconsistência do arquivo, não do usuário |
| 3 | Arquivo não vazio | O servidor rejeita 0 byte; falhar aqui evita a viagem |
| 4 | Tamanho ≤ 50 MB | Mesmo teto de `UploadOptions.MaxSizeBytes`; é o limite que mais dói pagar em rede |
| 5 | Assinatura do conteúdo (16 primeiros bytes) | É a única checagem que **lê o arquivo**, então roda por último e só sobre uma fatia |

Assinaturas aceitas: `ID3`/frame sync (MP3), `RIFF….WAVE` (WAV), `OggS` (OGG), `fLaC` (FLAC),
`ftyp` + marca conhecida (M4A), ADTS (AAC) e o header EBML (WEBM). A leitura é de
`file.slice(0, 16)` — nenhum arquivo é carregado inteiro em memória para ser validado.

## O fluxo

```
seleção / drag-and-drop
  └ useTranscription.selectFile
      ├ cancela a validação anterior (AbortController) e revoga o objectUrl antigo
      ├ validation = { status: "validating" }        → CTA "Validando áudio…", envio bloqueado
      └ validateAudioFileInBackground(file, signal)
            │
            ├─ new Worker(audioValidation.worker.ts)   ← thread separada
            │     └ validateAudioFile(file) → { valid } | { valid: false, message }
            │
            └─ sem Worker (ou construção falhou) → fallback assíncrono com o MESMO validador

  ← resultado
      ├ valid   → validation = { status: "valid" }    → CTA "Transcrever" habilitado
      ├ invalid → validation = { status: "invalid" }  → CTA "Arquivo inválido", motivo inline
      └ erro    → validation = { status: "error" }    → mesma sinalização, mensagem do validador

confirmação (UploadDialog)  →  só habilita com canUpload
  └ start(): aguarda a validação pendente, reconfere o estado e só então faz POST /api/audios
```

O `start()` **espera a tarefa pendente em vez de recusar**: confirmar durante a validação é uma
corrida legítima do usuário, e recusar por causa dela seria pedir um segundo clique. O que ele não
faz é enviar sem ter visto um `valid`.

### Cancelamento e falhas

| Situação | O que acontece |
| --- | --- |
| Outro arquivo é selecionado no meio da validação | A anterior é abortada e descartada por sequência; o resultado atrasado não pode sobrescrever o novo estado |
| Arquivo removido, `reset()` ou unmount | A validação é abortada e o Worker encerrado (`terminate`) |
| Worker lança, `messageerror`, ou `postMessage` falha | Estado `error` com mensagem acionável ("selecione o arquivo novamente"); nada é enviado |
| Worker não responde | Timeout de 10 s, `terminate` e o mesmo estado `error` |
| `Worker` indisponível no ambiente (SSR, jsdom, navegador antigo) | Fallback assíncrono com o mesmo validador — degrada o paralelismo, nunca a validação |

Em todos os caminhos o Worker é encerrado exatamente uma vez: quem resolve, rejeita, aborta ou
estoura o timeout passa pelo mesmo `settle`, que limpa o timer, remove o listener de `abort` e
termina a thread.

## Duas camadas, propósitos diferentes

O cliente **não substitui** a validação do servidor — nada impede um `POST` direto por `curl`, e a
API continua respondendo `400` para o que não passa em `AudioFileValidator`.

O cliente é, de propósito, **mais estrito** que a API: a API aceita `content-type audio/*` **ou**
extensão conhecida e não olha o conteúdo; o cliente exige extensão conhecida **e** MIME compatível
**e** assinatura correta. A consequência é assumida: um arquivo com extensão válida e conteúdo que
não é aquele formato é barrado no cliente, embora a API o aceitasse e só falhasse depois, no
`ffmpeg`, como `ProcessingStatus: "Failed"`. Bloquear antes é justamente o requisito.

## Lista de áudios e o novo envio

`GET /api/audios` é a fonte da verdade, mas ele só passa a conhecer o áudio novo depois do commit
do servidor. O `POST` já devolve o DTO autoritativo, então ele é inserido na lista na hora,
inclusive em `Pending`/`Processing`, e o `GET` seguinte reconcilia: quando o servidor já traz aquele
`id`, a versão do servidor vence; enquanto não traz, o item aceito é preservado no topo em vez de
desaparecer e voltar.

Consequência na tela: o toast de "lista indisponível" passou a considerar o histórico realmente
renderizado. O áudio da sessão viva não aparece duas vezes — ele já é contado embaixo, como a
sessão em andamento.

## Testes

Nenhuma asserção anterior foi alterada. O que entrou:

| Arquivo | Cobre |
| --- | --- |
| `web/__tests__/audio-validation.test.ts` | O caminho de aceite e as cinco rejeições (extensão, MIME, arquivo vazio, 50 MB, magic bytes) e o runner paralelo: fallback sem Worker, falha de runtime, falha interna reportada pelo Worker e timeout — os três últimos verificando o `terminate` |
| `web/__tests__/upload-validation-flow.test.tsx` | Na tela: estado "validando" com confirmação desabilitada, motivo exibido sem nenhum `POST`, e falha do Worker sem deixar a confirmação habilitada |
| `web/__tests__/useProcessedAudios.test.tsx` | Áudio `Pending` aceito pelo `POST` aparece antes do `GET` e sobrevive a um `GET` ainda desatualizado |
| `web/__tests__/useTranscription.test.tsx` | Casos novos na máquina de fases: `start()` bloqueado até um resultado válido, `uploadAudio` nunca chamado para arquivo inválido, falha do Worker mantendo o envio bloqueado, e `terminate` dos Workers pendentes em `reset` e unmount |

Resultado desta entrega, no mesmo host:

| Suíte | Resultado |
| --- | --- |
| `dotnet test` | 67/67 |
| `npm run test:run` | 139/139 (11 arquivos) |
| `npm run typecheck` | limpo |
| `npm run build` | limpo |

## O que não foi feito, e o gatilho para fazer

| Fora do escopo | Gatilho para revisitar |
| --- | --- |
| Descobrir extensões e teto do servidor por configuração/endpoint | Se `Upload:AllowedExtensions` ou `MaxSizeBytes` deixarem o padrão: hoje os dois valores estão duplicados no cliente e uma mudança no servidor exige mudar os dois |
| Decodificar o áudio no cliente (`AudioContext`) para provar que toca | Só valeria se falha de decodificação no `ffmpeg` se tornar frequente; hoje o custo em CPU e memória não se paga |
| Validar vários arquivos em paralelo (pool de Workers) | Quando a tela suportar fila de uploads — hoje o modelo é um áudio por vez |
| Aceitar arquivos cujo navegador não informa MIME type | Se aparecer um caso real de rejeição indevida; hoje os sete formatos aceitos têm MIME conhecido nos navegadores suportados |
| `role`/`aria-live` na mensagem de validação | A mensagem é estado persistente da seleção, não anúncio; uma terceira live region competiria com as duas que já existem |
