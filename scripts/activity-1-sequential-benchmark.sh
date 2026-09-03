#!/usr/bin/env bash
set -euo pipefail

# Compare the same published API with its two execution modes. Every sample gets a fresh
# process/database/file store; only Processing:ExecutionMode changes. Summarization is disabled so
# this measures the compression pipeline and its queue, not a remote Whisper dependency.

usage() {
    cat <<'EOF'
Usage:
  scripts/activity-1-sequential-benchmark.sh --output <csv> \
    [--rounds <n>=3] [--max-users <power-of-two>=8] \
    [--fixture-duration-seconds <n>=1] \
    [--max-concurrency <n>=4] [--queue-capacity <n>=max-users+2] \
    [--post-sla-ms <n>=2000] [--terminal-deadline-seconds <n>=60] \
    [--port <n>=51829] [--force]

Runs parallel and sequential modes at 1, 2, 4, ... users. A round passes only when every POST is
201, every admitted item reaches Completed before the common deadline, and POST p95 is within the
configured SLA. The CSV contains raw rounds; aggregate medians and savings belong in the report.
EOF
}

die() {
    printf 'benchmark error: %s\n' "$1" >&2
    exit 2
}

OUTPUT=''
ROUNDS=3
MAX_USERS=8
FIXTURE_DURATION_SECONDS=1
MAX_CONCURRENCY=4
QUEUE_CAPACITY=''
POST_SLA_MS=2000
TERMINAL_DEADLINE_SECONDS=60
PORT=51829
FORCE=false

while (($# > 0)); do
    case "$1" in
        --output) OUTPUT=$2; shift 2 ;;
        --rounds) ROUNDS=$2; shift 2 ;;
        --max-users) MAX_USERS=$2; shift 2 ;;
        --fixture-duration-seconds) FIXTURE_DURATION_SECONDS=$2; shift 2 ;;
        --max-concurrency) MAX_CONCURRENCY=$2; shift 2 ;;
        --queue-capacity) QUEUE_CAPACITY=$2; shift 2 ;;
        --post-sla-ms) POST_SLA_MS=$2; shift 2 ;;
        --terminal-deadline-seconds) TERMINAL_DEADLINE_SECONDS=$2; shift 2 ;;
        --port) PORT=$2; shift 2 ;;
        --force) FORCE=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

[[ -n "$OUTPUT" ]] || die '--output is required'
for value in "$ROUNDS" "$MAX_USERS" "$MAX_CONCURRENCY" "$POST_SLA_MS" "$TERMINAL_DEADLINE_SECONDS" "$PORT"; do
    [[ "$value" =~ ^[1-9][0-9]*$ ]] || die 'numeric options must be positive integers'
done
[[ "$FIXTURE_DURATION_SECONDS" =~ ^(0\.[0-9]+|[1-9][0-9]*(\.[0-9]+)?)$ ]] || die '--fixture-duration-seconds must be positive'
((MAX_USERS > 0 && (MAX_USERS & (MAX_USERS - 1)) == 0)) || die '--max-users must be a power of two'
if [[ -z "$QUEUE_CAPACITY" ]]; then
    QUEUE_CAPACITY=$((MAX_USERS + 2))
fi
[[ "$QUEUE_CAPACITY" =~ ^[1-9][0-9]*$ ]] || die '--queue-capacity must be a positive integer'
((QUEUE_CAPACITY >= MAX_USERS)) || die '--queue-capacity must be >= --max-users'

for command in awk curl date dotnet ffmpeg git mktemp sha256sum sed sort tail tr wc; do
    command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
done

REPO_ROOT=$(git rev-parse --show-toplevel)
PROJECT="$REPO_ROOT/src/AudioApi/AudioApi.csproj"
OUTPUT_DIR=$(dirname "$OUTPUT")
mkdir -p "$OUTPUT_DIR"
OUTPUT=$(cd "$OUTPUT_DIR" && pwd)/$(basename "$OUTPUT")
if [[ -e "$OUTPUT" && "$FORCE" != true ]]; then
    die "output already exists; pass --force to replace it: $OUTPUT"
fi

WORK_ROOT=$(mktemp -d /tmp/audioapi-sequential-benchmark.XXXXXX)
PUBLISH_DIR="$WORK_ROOT/publish"
mkdir -p "$PUBLISH_DIR"
SERVER_PID=''

cleanup() {
    if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK_ROOT"
}
trap cleanup EXIT INT TERM

dotnet restore "$PROJECT" --nologo >/dev/null
dotnet publish "$PROJECT" --configuration Release --output "$PUBLISH_DIR" --no-restore --nologo >/dev/null

FIXTURE="$WORK_ROOT/fixture.wav"
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=1000:duration=$FIXTURE_DURATION_SECONDS" \
    -ar 8000 -ac 1 -c:a pcm_s16le -y "$FIXTURE"
FIXTURE_SHA=$(sha256sum "$FIXTURE" | awk '{print $1}')
FIXTURE_BYTES=$(wc -c < "$FIXTURE" | tr -d ' ')

CSV_HEADER='mode,round,users,fixture_sha256,fixture_bytes,fixture_duration_seconds,http_201_count,http_503_count,http_other_count,completed_count,failed_count,pending_count,processing_count,missing_count,post_p50_ms,post_p95_ms,max_post_ms,makespan_ms,jobs_per_second,criterion_pass'
printf '%s\n' "$CSV_HEADER" > "$OUTPUT"

start_server() {
    local mode=$1
    local run_dir=$2
    mkdir -p "$run_dir/data" "$run_dir/filestore"
    (
        cd "$PUBLISH_DIR"
        exec env \
            ASPNETCORE_ENVIRONMENT=Production \
            ASPNETCORE_URLS="http://127.0.0.1:$PORT" \
            ConnectionStrings__Default="Data Source=$run_dir/data/audios.db" \
            Storage__LocalPath="$run_dir/filestore" \
            Processing__ExecutionMode="$mode" \
            Processing__MaxConcurrency="$MAX_CONCURRENCY" \
            Processing__QueueCapacity="$QUEUE_CAPACITY" \
            Summarization__Enabled=false \
            Compression__FfmpegPath="$(command -v ffmpeg)" \
            Logging__LogLevel__Default=Warning \
            dotnet AudioApi.dll >"$run_dir/server.log" 2>&1
    ) &
    SERVER_PID=$!

    local health_deadline=$((SECONDS + 30))
    while ((SECONDS < health_deadline)); do
        if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
            return
        fi
        if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
            sed -n '1,160p' "$run_dir/server.log" >&2 || true
            die "API exited before becoming healthy in $mode mode"
        fi
        sleep 0.1
    done
    sed -n '1,160p' "$run_dir/server.log" >&2 || true
    die "API did not become healthy within 30 seconds in $mode mode"
}

stop_server() {
    if [[ -n "$SERVER_PID" ]]; then
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
    local start_ns end_ns elapsed_ms status id
    start_ns=$(date +%s%N)
    curl -sS --max-time 15 \
        -o "$body" -w '%{http_code}' \
        -F "file=@$FIXTURE;filename=benchmark-$index.wav;type=audio/wav" \
        "http://127.0.0.1:$PORT/api/audios/" > "$response" 2>/dev/null || true
    end_ns=$(date +%s%N)
    status=$(sed -n '1p' "$response" 2>/dev/null || true)
    elapsed_ms=$(awk -v start="$start_ns" -v end="$end_ns" 'BEGIN { printf "%.3f", (end-start)/1000000 }')
    id=''
    if [[ "$status" == 201 ]]; then
        id=$(json_value id "$body" 2>/dev/null || true)
    fi
    printf '%s\t%s\t%s\n' "$status" "$elapsed_ms" "$id" > "$result_dir/meta-$index.txt"
}

poll_one() {
    local index=$1
    local result_dir=$2
    local id=$3
    local deadline_ns=$4
    local status=''
    local body="$result_dir/status-$index.json"
    while (( $(date +%s%N) < deadline_ns )); do
        if curl -sS --max-time 2 -o "$body" "http://127.0.0.1:$PORT/api/audios/$id" >/dev/null 2>&1; then
            status=$(json_value processingStatus "$body" || true)
            if [[ "$status" == Completed || "$status" == Failed ]]; then
                printf '%s\n' "$status" > "$result_dir/final-$index.txt"
                return
            fi
        fi
        sleep 0.05
    done
    if [[ -z "$status" ]]; then
        status=Missing
    fi
    printf '%s\n' "$status" > "$result_dir/final-$index.txt"
}

percentile_ms() {
    local input=$1
    local percentile=$2
    local count
    count=$(wc -l < "$input" | tr -d ' ')
    ((count > 0)) || { printf '0.000\n'; return; }
    awk -v count="$count" -v percentile="$percentile" \
        'BEGIN { target = int((percentile * count) + 0.999999); if (target < 1) target = 1 }
         NR == target { printf "%.3f\n", $1; exit }' <(sort -n "$input")
}

run_round() {
    local mode=$1
    local round=$2
    local users=$3
    local run_dir="$WORK_ROOT/run-$mode-$users-$round"
    local result_dir="$run_dir/results"
    local index status elapsed_ms id
    printf 'run mode=%s users=%s round=%s/%s\n' "$mode" "$users" "$round" "$ROUNDS"
    mkdir -p "$result_dir"
    start_server "$mode" "$run_dir"

    # Warm database, Kestrel and ffmpeg in this fresh process; exclude warm-up from CSV.
    post_one warmup "$result_dir"
    local warm_status warm_elapsed warm_id
    IFS=$'\t' read -r warm_status warm_elapsed warm_id < "$result_dir/meta-warmup.txt" || true
    if [[ "$warm_status" == 201 && -n "$warm_id" ]]; then
        poll_one warmup "$result_dir" "$warm_id" "$(( $(date +%s%N) + TERMINAL_DEADLINE_SECONDS * 1000000000 ))"
    fi

    local round_start_ns deadline_ns end_ns makespan_ms
    round_start_ns=$(date +%s%N)
    deadline_ns=$((round_start_ns + TERMINAL_DEADLINE_SECONDS * 1000000000))
    local post_pids='' poll_pids=''
    for ((index = 1; index <= users; index++)); do
        post_one "$index" "$result_dir" &
        post_pids="$post_pids $!"
    done
    for pid in $post_pids; do wait "$pid" || true; done

    local post_ms_file="$result_dir/post-ms.txt"
    : > "$post_ms_file"
    local http_201=0 http_503=0 http_other=0
    for ((index = 1; index <= users; index++)); do
        IFS=$'\t' read -r status elapsed_ms id < "$result_dir/meta-$index.txt" || true
        printf '%s\n' "$elapsed_ms" >> "$post_ms_file"
        case "$status" in
            201)
                ((http_201 += 1))
                if [[ -n "$id" ]]; then
                    poll_one "$index" "$result_dir" "$id" "$deadline_ns" &
                    poll_pids="$poll_pids $!"
                fi
                ;;
            503) ((http_503 += 1)) ;;
            *) ((http_other += 1)) ;;
        esac
    done
    for pid in $poll_pids; do wait "$pid" || true; done

    local completed=0 failed=0 pending=0 processing=0 missing=0
    for ((index = 1; index <= users; index++)); do
        if [[ ! -f "$result_dir/final-$index.txt" ]]; then
            ((missing += 1))
            continue
        fi
        status=$(<"$result_dir/final-$index.txt")
        case "$status" in
            Completed) ((completed += 1)) ;;
            Failed) ((failed += 1)) ;;
            Pending) ((pending += 1)) ;;
            Processing) ((processing += 1)) ;;
            *) ((missing += 1)) ;;
        esac
    done

    end_ns=$(date +%s%N)
    makespan_ms=$(awk -v start="$round_start_ns" -v end="$end_ns" 'BEGIN { printf "%.3f", (end-start)/1000000 }')
    local post_p50 post_p95 max_post jobs_per_second criterion='false'
    post_p50=$(percentile_ms "$post_ms_file" 0.50)
    post_p95=$(percentile_ms "$post_ms_file" 0.95)
    max_post=$(sort -n "$post_ms_file" | tail -1)
    if [[ -z "$max_post" ]]; then
        max_post=0.000
    fi
    jobs_per_second=$(awk -v jobs="$completed" -v ms="$makespan_ms" \
        'BEGIN { if (ms == 0) print "0.000"; else printf "%.3f", jobs/(ms/1000) }')
    if ((http_201 == users && http_503 == 0 && http_other == 0 \
        && completed == users && failed == 0 && pending == 0 && processing == 0 && missing == 0)) \
        && awk -v p95="$post_p95" -v sla="$POST_SLA_MS" 'BEGIN { exit !(p95 <= sla) }'; then
        criterion=true
    fi

    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
        "$mode" "$round" "$users" "$FIXTURE_SHA" "$FIXTURE_BYTES" "$FIXTURE_DURATION_SECONDS" \
        "$http_201" "$http_503" "$http_other" "$completed" "$failed" "$pending" "$processing" \
        "$missing" "$post_p50" "$post_p95" "$max_post" "$makespan_ms" "$jobs_per_second" "$criterion" >> "$OUTPUT"
    stop_server
}

printf 'fixture_sha256=%s fixture_bytes=%s duration_seconds=%s\n' \
    "$FIXTURE_SHA" "$FIXTURE_BYTES" "$FIXTURE_DURATION_SECONDS"
printf 'modes=parallel,sequential rounds=%s users=1..%s max_concurrency=%s queue_capacity=%s\n' \
    "$ROUNDS" "$MAX_USERS" "$MAX_CONCURRENCY" "$QUEUE_CAPACITY"

for ((users = 1; users <= MAX_USERS; users *= 2)); do
    for ((round = 1; round <= ROUNDS; round++)); do
        # Alternate which mode starts each pair to reduce warm-host/order bias.
        if (((users + round) % 2 == 0)); then
            run_round parallel "$round" "$users"
            run_round sequential "$round" "$users"
        else
            run_round sequential "$round" "$users"
            run_round parallel "$round" "$users"
        fi
    done
done

printf 'csv=%s\n' "$OUTPUT"
