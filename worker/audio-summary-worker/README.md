# Audio Summary Worker

Serviço HTTP que hospeda o **modelo de IA leve local** usado pela `AudioApi`: transcreve um áudio
com **Whisper `tiny`** ([faster-whisper](https://github.com/SYSTRAN/faster-whisper), CTranslate2,
int8, CPU) e devolve um **resumo de no máximo 500 caracteres**.

A API .NET é apenas um cliente HTTP (`AudioApi.Summarization.WhisperAudioSummarizer`) — ela não
carrega modelo, não tem Python e não sabe qual implementação está do outro lado.

## Contrato

### `GET /health`

```json
{
  "status": "healthy",
  "model": "tiny",
  "device": "cpu",
  "compute_type": "int8",
  "model_loaded": true,
  "max_chars_ceiling": 500
}
```

### `POST /summarize`

`multipart/form-data`:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `file` | arquivo | O áudio. Qualquer formato que o PyAV/FFmpeg decodifique (a API envia `.m4a`/AAC). |
| `max_chars` | inteiro | Limite de caracteres do resumo. Limitado a `MAX_CHARS_CEILING`. |

Header `X-API-Key` obrigatório quando `WORKER_API_KEY` está definido.

**200:**

```json
{
  "summary": "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.",
  "language": "en",
  "transcript_chars": 106,
  "duration_seconds": 11.0,
  "elapsed_seconds": 1.03,
  "model": "tiny"
}
```

**Erros:** `400` upload vazio · `401` `X-API-Key` inválida · `413` upload acima de
`MAX_UPLOAD_BYTES` · `422` áudio não decodificável ou sem fala detectada.

## Como o resumo é produzido

1. **Transcrição** (`app.py`): Whisper `tiny` com `vad_filter=True` (descarta silêncio) e
   `beam_size=1` (busca gulosa — mais rápida, suficiente para resumo).
2. **Sumarização extrativa** (`summarizer.py`), sem segundo modelo:
   - quebra o texto em frases;
   - pontua cada frase pela frequência dos seus termos de conteúdo (stopwords pt/en/es removidas),
     normalizada por `sqrt(nº de termos)` e com um leve bônus de posição para as frases iniciais;
   - escolhe gulosamente as frases de maior pontuação que **cabem no orçamento de caracteres**;
   - reemite as escolhidas na **ordem original** e aplica um corte final de segurança.
3. Se a transcrição já cabe no limite, ela **é** o resumo.

O limite de caracteres é reaplicado do lado .NET por `SummaryTruncator.Clamp` — ver
[`docs/week3-threading-explanation.md`](../../docs/week3-threading-explanation.md).

## Deploy

O worker escuta em **`127.0.0.1:9000`** — não é publicado na internet. O acesso de fora da máquina
é por **túnel SSH**.

```bash
# na máquina de dev: copiar os arquivos
ssh <host> 'mkdir -p ~/audio-summary-worker'
tar czf - summarizer.py app.py requirements.txt Dockerfile docker-compose.yml \
  | ssh <host> 'tar xzf - -C ~/audio-summary-worker'

# no servidor: gerar a chave e subir
ssh <host>
cd ~/audio-summary-worker
printf 'WORKER_API_KEY=%s\nWHISPER_MODEL=tiny\nWHISPER_COMPUTE_TYPE=int8\nWHISPER_CPU_THREADS=4\nWHISPER_BEAM_SIZE=1\nMAX_CHARS_CEILING=500\n' "$(openssl rand -hex 24)" > .env
chmod 600 .env
docker compose up -d --build

curl -sS http://127.0.0.1:9000/health
```

`.env` não é versionado — a chave é gerada por servidor.

### Consumir a partir da máquina de dev

```bash
ssh -N -L 9000:127.0.0.1:9000 <host> &

Summarization__Enabled=true \
Summarization__Endpoint=http://localhost:9000 \
Summarization__ApiKey=$(ssh <host> 'grep WORKER_API_KEY ~/audio-summary-worker/.env | cut -d= -f2') \
dotnet run --project src/AudioApi
```

### Teste direto do worker

```bash
KEY=$(grep WORKER_API_KEY .env | cut -d= -f2)
curl -sS -X POST http://127.0.0.1:9000/summarize \
  -H "X-API-Key: $KEY" \
  -F "file=@amostra.wav;type=audio/wav" \
  -F "max_chars=500"
```

## Configuração

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `WORKER_API_KEY` | — (obrigatória no compose) | Valor esperado no header `X-API-Key`. Vazia = sem autenticação. |
| `WHISPER_MODEL` | `tiny` | `tiny`, `base`, `small`, `medium`, `large-v3`. |
| `WHISPER_COMPUTE_TYPE` | `int8` | Quantização. `int8` é a mais leve em CPU. |
| `WHISPER_DEVICE` | `cpu` | `cuda` se houver GPU. |
| `WHISPER_CPU_THREADS` | `4` | Threads do CTranslate2. Case com as vCPUs do host. |
| `WHISPER_BEAM_SIZE` | `1` | `1` = guloso (rápido); `5` = mais preciso e bem mais lento. |
| `MAX_CHARS_CEILING` | `500` | Teto absoluto do resumo; um `max_chars` maior é reduzido a este valor. |
| `MAX_UPLOAD_BYTES` | `67108864` | 64 MB. Acima disso, `413`. |

### Escolha do modelo

| Modelo | Pesos | Velocidade em CPU (4 vCPU) | Quando usar |
|--------|-------|----------------------------|-------------|
| `tiny` | ~75 MB | ~10x tempo real | Padrão. 11s de áudio ≈ 1s. |
| `base` | ~145 MB | ~6x tempo real | Melhor precisão, ainda leve. |
| `small` | ~480 MB | ~2x tempo real | Só com RAM/CPU sobrando. |

Medido na VPS de referência (4 vCPU, 7,7 GB): `tiny`/int8 transcreveu 11s de fala em **1,03s**.
Trocar de modelo é mudar `WHISPER_MODEL` no `.env` e `docker compose up -d` — os pesos são baixados
no primeiro uso e ficam no volume `whisper-models`.

## Operação

```bash
docker compose logs -f --tail 50     # logs
docker compose restart               # reiniciar
docker compose down                  # parar (mantém o volume dos modelos)
docker compose down -v               # parar e apagar os pesos baixados
```

Endurecimento aplicado no `docker-compose.yml`: bind apenas em `127.0.0.1`, usuário não-root
(uid 1001), `cap_drop: ALL`, `no-new-privileges`, `/tmp` em tmpfs, limite de memória de 3 GB,
healthcheck em `/health`.

O primeiro `POST /summarize` após subir o container é mais lento: os pesos são baixados e o modelo
carregado (uma vez, com lock — requisições concorrentes esperam em vez de carregar em duplicado).
