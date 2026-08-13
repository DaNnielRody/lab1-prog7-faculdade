#!/usr/bin/env bash
set -euo pipefail

# Reproduces the simultaneous-upload comparison for the parallel audio activity.
# The script builds each source in Release, starts the real HTTP API, and records
# every upload/status observation in CSV. It does not infer capacity from config.

usage() {
    cat <<'EOF'
Usage:
  activity-1-week-6-parallel-audio-benchmark.sh \
    --before-ref <git-ref> --after-source <directory> --output <csv> \
    [--before-label <label>] [--after-label <label>] \
    [--rounds <n>] [--levels <comma-list>] [--max-concurrency <n>] \
    [--post-sla-ms <n>] \
    [--terminal-deadline-seconds <n>] [--port <n>]

The before source is exported with git archive from the repository containing
this script. The after source is an existing checkout (normally the current
working tree, including uncommitted changes).
EOF
}

die() {
    printf 'benchmark error: %s\n' "$1" >&2
    exit 2
}

BEFORE_REF=''
AFTER_SOURCE=''
OUTPUT=''
BEFORE_LABEL='before'
AFTER_LABEL='after'
ROUNDS=3
LEVELS='1,2,4,8'
MAX_CONCURRENCY=4
POST_SLA_MS=2000
TERMINAL_DEADLINE_SECONDS=30
PORT=51819

while (($# > 0)); do
    case "$1" in
        --before-ref)
            (($# >= 2)) || die "--before-ref needs a value"
            BEFORE_REF=$2
            shift 2
            ;;
        --after-source)
            (($# >= 2)) || die "--after-source needs a value"
            AFTER_SOURCE=$2
            shift 2
            ;;
        --output)
            (($# >= 2)) || die "--output needs a value"
            OUTPUT=$2
            shift 2
            ;;
        --before-label)
            (($# >= 2)) || die "--before-label needs a value"
            BEFORE_LABEL=$2
            shift 2
            ;;
        --after-label)
            (($# >= 2)) || die "--after-label needs a value"
            AFTER_LABEL=$2
            shift 2
            ;;
        --rounds)
            (($# >= 2)) || die "--rounds needs a value"
            ROUNDS=$2
            shift 2
            ;;
        --levels)
            (($# >= 2)) || die "--levels needs a value"
            LEVELS=$2
            shift 2
            ;;
        --max-concurrency)
            (($# >= 2)) || die "--max-concurrency needs a value"
            MAX_CONCURRENCY=$2
            shift 2
            ;;
        --post-sla-ms)
            (($# >= 2)) || die "--post-sla-ms needs a value"
            POST_SLA_MS=$2
            shift 2
            ;;
        --terminal-deadline-seconds)
            (($# >= 2)) || die "--terminal-deadline-seconds needs a value"
            TERMINAL_DEADLINE_SECONDS=$2
            shift 2
            ;;
        --port)
            (($# >= 2)) || die "--port needs a value"
            PORT=$2
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
done

[[ -n "$BEFORE_REF" ]] || die "--before-ref is required"
[[ -n "$AFTER_SOURCE" ]] || die "--after-source is required"
[[ -n "$OUTPUT" ]] || die "--output is required"
[[ "$ROUNDS" =~ ^[1-9][0-9]*$ ]] || die "--rounds must be a positive integer"
[[ "$MAX_CONCURRENCY" =~ ^[1-9][0-9]*$ ]] || die "--max-concurrency must be a positive integer"
[[ "$POST_SLA_MS" =~ ^[1-9][0-9]*$ ]] || die "--post-sla-ms must be a positive integer"
[[ "$TERMINAL_DEADLINE_SECONDS" =~ ^[1-9][0-9]*$ ]] || die "--terminal-deadline-seconds must be a positive integer"
[[ "$PORT" =~ ^[1-9][0-9]*$ ]] || die "--port must be a positive integer"
[[ -d "$AFTER_SOURCE" ]] || die "after source does not exist: $AFTER_SOURCE"

for command in awk curl dotnet ffmpeg git mktemp sha256sum sed sort; do
    command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
done

REPO_ROOT=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
AFTER_SOURCE=$(cd "$AFTER_SOURCE" && pwd)
OUTPUT=$(mkdir -p "$(dirname "$OUTPUT")" && cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")
WORK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/parallel-audio-benchmark.XXXXXX")
BEFORE_SOURCE="$WORK_ROOT/before-source"
PUBLISH_ROOT="$WORK_ROOT/publish"
mkdir -p "$BEFORE_SOURCE" "$PUBLISH_ROOT"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK_ROOT"
}
trap cleanup EXIT INT TERM

git -C "$REPO_ROOT" archive "$BEFORE_REF" | tar -x -C "$BEFORE_SOURCE"

FIXTURE="$WORK_ROOT/fixture.wav"
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=1000:duration=0.25' \
    -ar 8000 -ac 1 -c:a pcm_s16le -y "$FIXTURE"
FIXTURE_SHA=$(sha256sum "$FIXTURE" | awk '{print $1}')
FIXTURE_BYTES=$(wc -c < "$FIXTURE" | tr -d ' ')

printf 'source,source_ref,max_concurrency,round,users,fixture_sha256,fixture_bytes,post_201_count,terminal_count,completed_count,failed_count,post_p95_ms,max_post_ms,terminal_elapsed_ms,criterion_pass\n' > "$OUTPUT"

publish_source() {
    local source=$1
    local name=$2
    local project="$source/src/AudioApi/AudioApi.csproj"
    local publish_dir="$PUBLISH_ROOT/$name"

    [[ -f "$project" ]] || die "API project missing in $source"
    mkdir -p "$publish_dir"
    dotnet restore "$project" --nologo >/dev/null
    dotnet publish "$project" --configuration Release --output "$publish_dir" --no-restore --nologo >/dev/null
    printf '%s\n' "$publish_dir"
}

start_server() {
    local publish_dir=$1
    local run_dir=$2
    local max_concurrency=$3

    mkdir -p "$run_dir/data" "$run_dir/filestore"
    (
        cd "$publish_dir"
        exec env \
            ASPNETCORE_ENVIRONMENT=Production \
            ASPNETCORE_URLS="http://127.0.0.1:$PORT" \
            ConnectionStrings__Default="Data Source=$run_dir/data/audios.db" \
            Storage__LocalPath="$run_dir/filestore" \
            Processing__MaxConcurrency="$max_concurrency" \
            Processing__QueueCapacity=100 \
            Summarization__Enabled=false \
            Compression__FfmpegPath="$(command -v ffmpeg)" \
            Logging__LogLevel__Default=Warning \
            dotnet AudioApi.dll >"$run_dir/server.log" 2>&1
    ) &
    SERVER_PID=$!

    local deadline=$((SECONDS + 20))
    while ((SECONDS < deadline)); do
        if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
            return 0
        fi
        if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
            sed -n '1,160p' "$run_dir/server.log" >&2 || true
            die "API exited before becoming healthy (max concurrency $max_concurrency)"
        fi
        sleep 0.1
    done
    sed -n '1,160p' "$run_dir/server.log" >&2 || true
    die "API did not become healthy within 20 seconds"
}

stop_server() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
        SERVER_PID=''
    fi
}

json_value() {
    local key=$1
    local body=$2
    sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$body" | head -1
}

post_one() {
    local index=$1
    local result_dir=$2
    local body="$result_dir/body-$index.json"
    local response="$result_dir/post-$index.txt"
    local start_ns end_ns elapsed_ms status

    start_ns=$(date +%s%N)
    curl -sS --max-time "$((POST_SLA_MS / 1000 + 5))" \
        -o "$body" -w '%{http_code}' \
        -F "file=@$FIXTURE;filename=benchmark.wav;type=audio/wav" \
        "http://127.0.0.1:$PORT/api/audios/" > "$response" 2>/dev/null || true
    end_ns=$(date +%s%N)
    status=$(sed -n '1p' "$response" 2>/dev/null || true)
    elapsed_ms=$(awk -v start="$start_ns" -v end="$end_ns" 'BEGIN { printf "%.3f", (end-start)/1000000 }')
    printf '%s\t%s\t%s\n' "$status" "$elapsed_ms" "$(json_value id "$body" 2>/dev/null || true)" > "$result_dir/meta-$index.txt"
}

poll_one() {
    local index=$1
    local result_dir=$2
    local id=$3
    local deadline=$4
    local status=''
    local body="$result_dir/status-$index.json"

    while ((SECONDS < deadline)); do
        if curl -sS --max-time 2 -o "$body" "http://127.0.0.1:$PORT/api/audios/$id" >/dev/null 2>&1; then
            status=$(json_value processingStatus "$body" || true)
            if [[ "$status" == 'Completed' || "$status" == 'Failed' ]]; then
                printf '%s\t%s\n' "$status" "$SECONDS" > "$result_dir/terminal-$index.txt"
                return 0
            fi
        fi
        sleep 0.1
    done
    printf 'Timeout\t%s\n' "$SECONDS" > "$result_dir/terminal-$index.txt"
}

p95_ms() {
    local input=$1
    local count
    count=$(wc -l < "$input" | tr -d ' ')
    if ((count == 0)); then
        printf '0.000\n'
        return
    fi
    awk -v rank="$count" 'BEGIN { target = int((0.95 * rank) + 0.999999) } NR == target { printf "%.3f\n", $1; exit }' \
        <(sort -n "$input")
}

run_round() {
    local source_label=$1
    local source_ref=$2
    local publish_dir=$3
    local max_concurrency=$4
    local round=$5
    local users=$6
    local run_dir="$WORK_ROOT/run-$source_label-$max_concurrency-$round-$users"
    local result_dir="$run_dir/results"
    local post_201_count=0 terminal_count=0 completed_count=0 failed_count=0
    local max_post_ms='0.000' terminal_elapsed_ms='0'
    local round_start_ns end_ns
    local terminal_deadline=$((SECONDS + TERMINAL_DEADLINE_SECONDS))
    local -a post_pids=() poll_pids=()
    mkdir -p "$result_dir"
    round_start_ns=$(date +%s%N)

    for ((index = 1; index <= users; index++)); do
        post_one "$index" "$result_dir" &
        post_pids+=("$!")
    done
    for pid in "${post_pids[@]}"; do
        wait "$pid" || true
    done

    local post_ms_file="$result_dir/post-ms.txt"
    : > "$post_ms_file"
    for ((index = 1; index <= users; index++)); do
        IFS=$'\t' read -r status elapsed_ms id < "$result_dir/meta-$index.txt" || true
        printf '%s\n' "$elapsed_ms" >> "$post_ms_file"
        if [[ "$status" == '201' ]]; then
            ((post_201_count += 1))
            if [[ -n "$id" ]]; then
                poll_one "$index" "$result_dir" "$id" "$terminal_deadline" &
                poll_pids+=("$!")
            fi
        fi
    done
    for pid in "${poll_pids[@]}"; do
        wait "$pid" || true
    done

    while IFS= read -r elapsed_ms; do
        if awk -v current="$elapsed_ms" -v max="$max_post_ms" 'BEGIN { exit !(current > max) }'; then
            max_post_ms=$elapsed_ms
        fi
    done < "$post_ms_file"

    for ((index = 1; index <= users; index++)); do
        if [[ -f "$result_dir/terminal-$index.txt" ]]; then
            IFS=$'\t' read -r status terminal_second < "$result_dir/terminal-$index.txt" || true
            if [[ "$status" == 'Completed' || "$status" == 'Failed' ]]; then
                ((terminal_count += 1))
            fi
            if [[ "$status" == 'Completed' ]]; then
                ((completed_count += 1))
            elif [[ "$status" == 'Failed' ]]; then
                ((failed_count += 1))
            fi
        fi
    done
    end_ns=$(date +%s%N)
    terminal_elapsed_ms=$(awk -v start="$round_start_ns" -v end="$end_ns" 'BEGIN { printf "%.3f", (end-start)/1000000 }')
    local post_p95
    post_p95=$(p95_ms "$post_ms_file")
    local criterion='false'
    if ((post_201_count == users && terminal_count == users && completed_count == users && failed_count == 0)) && \
        awk -v p95="$post_p95" -v sla="$POST_SLA_MS" 'BEGIN { exit !(p95 <= sla) }'; then
        criterion='true'
    fi

    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
        "$source_label" "$source_ref" "$max_concurrency" "$round" "$users" \
        "$FIXTURE_SHA" "$FIXTURE_BYTES" "$post_201_count" "$terminal_count" \
        "$completed_count" "$failed_count" "$post_p95" "$max_post_ms" \
        "$terminal_elapsed_ms" "$criterion" >> "$OUTPUT"
}

run_source() {
    local source_label=$1
    local source_ref=$2
    local source_dir=$3
    local publish_dir
    publish_dir=$(publish_source "$source_dir" "$source_label")

    IFS=',' read -ra level_list <<< "$LEVELS"
    local run_dir="$WORK_ROOT/warmup-$source_label-$MAX_CONCURRENCY"
    mkdir -p "$run_dir/results"
    start_server "$publish_dir" "$run_dir" "$MAX_CONCURRENCY"

    # Warm-up is intentionally excluded from CSV and uses the same fixture.
    post_one warmup "$run_dir/results" || true
    IFS=$'\t' read -r warm_status warm_elapsed warm_id < "$run_dir/results/meta-warmup.txt" 2>/dev/null || true
    if [[ "$warm_status" == '201' && -n "$warm_id" ]]; then
        poll_one warmup "$run_dir/results" "$warm_id" "$((SECONDS + TERMINAL_DEADLINE_SECONDS))" || true
    fi

    for ((round = 1; round <= ROUNDS; round++)); do
        for users in "${level_list[@]}"; do
            [[ "$users" =~ ^[1-9][0-9]*$ ]] || die "invalid level: $users"
            run_round "$source_label" "$source_ref" "$publish_dir" "$MAX_CONCURRENCY" "$round" "$users"
        done
    done
    stop_server
}

BEFORE_PUBLISH_REF=$BEFORE_REF
AFTER_SOURCE_REF=$(git -C "$AFTER_SOURCE" rev-parse HEAD 2>/dev/null || printf 'working-tree')
if [[ -n "$(git -C "$AFTER_SOURCE" status --porcelain 2>/dev/null || true)" ]]; then
    AFTER_SOURCE_REF="$AFTER_SOURCE_REF+working-tree"
fi

printf 'fixture=%s bytes=%s\n' "$FIXTURE_SHA" "$FIXTURE_BYTES"
printf 'before=%s ref=%s\n' "$BEFORE_LABEL" "$BEFORE_PUBLISH_REF"
printf 'after=%s ref=%s\n' "$AFTER_LABEL" "$AFTER_SOURCE_REF"
printf 'levels=%s rounds=%s max_concurrency=%s post_sla_ms=%s terminal_deadline_seconds=%s\n' \
    "$LEVELS" "$ROUNDS" "$MAX_CONCURRENCY" "$POST_SLA_MS" "$TERMINAL_DEADLINE_SECONDS"

run_source "$BEFORE_LABEL" "$BEFORE_PUBLISH_REF" "$BEFORE_SOURCE"
run_source "$AFTER_LABEL" "$AFTER_SOURCE_REF" "$AFTER_SOURCE"

printf 'csv=%s\n' "$OUTPUT"
