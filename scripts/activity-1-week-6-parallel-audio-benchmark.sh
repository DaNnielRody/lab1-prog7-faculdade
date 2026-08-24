#!/usr/bin/env bash
set -euo pipefail

# Progressive, same-host comparison of simultaneous audio users. Each user sends one WAV and
# waits for a terminal processing state. Every measured round starts a fresh API process, SQLite
# database, and file store. Summarization is intentionally disabled in the primary comparison.

usage() {
    cat <<'EOF'
Usage:
  activity-1-week-6-parallel-audio-benchmark.sh \
    --before-ref <git-ref> --after-source <directory> --output <csv> \
    [--before-label <label>] [--after-label <label>] \
    [--rounds <n>=5] [--start-users <power-of-two>=1] \
    [--max-users <power-of-two>=64] [--append] \
    [--max-concurrency <n>=4] [--queue-capacity <n>=max-users] \
    [--post-sla-ms <n>=2000] [--terminal-deadline-seconds <n>=30] \
    [--port <n>=51819]

The script tests 1,2,4,... until each source has its first confirmed failed level or
--max-users is reached. A failed level is repeated once after the five primary rounds. If that
confirmation passes, the level is reported as inconclusive and the script stops that source
instead of claiming a noisy limit.
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
ROUNDS=5
MAX_USERS=64
START_USERS=1
MAX_CONCURRENCY=4
QUEUE_CAPACITY=''
POST_SLA_MS=2000
TERMINAL_DEADLINE_SECONDS=30
PORT=51819
APPEND=false

while (($# > 0)); do
    case "$1" in
        --before-ref) BEFORE_REF=${2:-}; shift 2 ;;
        --after-source) AFTER_SOURCE=${2:-}; shift 2 ;;
        --output) OUTPUT=${2:-}; shift 2 ;;
        --before-label) BEFORE_LABEL=${2:-}; shift 2 ;;
        --after-label) AFTER_LABEL=${2:-}; shift 2 ;;
        --rounds) ROUNDS=${2:-}; shift 2 ;;
        --start-users) START_USERS=${2:-}; shift 2 ;;
        --max-users) MAX_USERS=${2:-}; shift 2 ;;
        --max-concurrency) MAX_CONCURRENCY=${2:-}; shift 2 ;;
        --queue-capacity) QUEUE_CAPACITY=${2:-}; shift 2 ;;
        --post-sla-ms) POST_SLA_MS=${2:-}; shift 2 ;;
        --terminal-deadline-seconds) TERMINAL_DEADLINE_SECONDS=${2:-}; shift 2 ;;
        --port) PORT=${2:-}; shift 2 ;;
        --append) APPEND=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

[[ -n "$BEFORE_REF" ]] || die '--before-ref is required'
[[ -n "$AFTER_SOURCE" ]] || die '--after-source is required'
[[ -n "$OUTPUT" ]] || die '--output is required'
for value_name in ROUNDS START_USERS MAX_USERS MAX_CONCURRENCY POST_SLA_MS TERMINAL_DEADLINE_SECONDS PORT; do
    value=${!value_name}
    [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "$value_name must be a positive integer"
done
((ROUNDS >= 5)) || die '--rounds must be at least 5'
((START_USERS > 0 && (START_USERS & (START_USERS - 1)) == 0)) || die '--start-users must be a power of two'
((MAX_USERS > 0 && (MAX_USERS & (MAX_USERS - 1)) == 0)) || die '--max-users must be a power of two'
((START_USERS <= MAX_USERS)) || die '--start-users must be <= --max-users'
QUEUE_CAPACITY=${QUEUE_CAPACITY:-$MAX_USERS}
[[ "$QUEUE_CAPACITY" =~ ^[1-9][0-9]*$ ]] || die '--queue-capacity must be a positive integer'
((QUEUE_CAPACITY >= MAX_USERS)) || die '--queue-capacity must be >= --max-users for the primary capacity comparison'
[[ -d "$AFTER_SOURCE" ]] || die "after source does not exist: $AFTER_SOURCE"
[[ "$BEFORE_LABEL" != *,* && "$AFTER_LABEL" != *,* ]] || die 'labels cannot contain commas'

for command in awk curl date dotnet ffmpeg git mktemp sha256sum sed sort tar; do
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

CSV_HEADER='source,source_ref,max_concurrency,queue_capacity,phase,round,users,fixture_sha256,fixture_bytes,http_201_count,http_429_count,http_503_count,http_other_count,overload_rejected_count,terminal_count,completed_count,failed_count,pending_count,processing_count,missing_count,discard_observation,post_p50_ms,post_p95_ms,max_post_ms,makespan_ms,jobs_per_second,criterion_pass'
if [[ "$APPEND" == true ]]; then
    [[ -f "$OUTPUT" ]] || die '--append requires an existing output CSV'
    [[ "$(sed -n '1p' "$OUTPUT")" == "$CSV_HEADER" ]] || die 'existing CSV header does not match'
else
    printf '%s\n' "$CSV_HEADER" > "$OUTPUT"
fi

publish_source() {
    local source=$1 name=$2 project publish_dir
    project="$source/src/AudioApi/AudioApi.csproj"
    publish_dir="$PUBLISH_ROOT/$name"
    [[ -f "$project" ]] || die "API project missing in $source"
    mkdir -p "$publish_dir"
    dotnet restore "$project" --nologo >/dev/null
    dotnet publish "$project" --configuration Release --output "$publish_dir" --no-restore --nologo >/dev/null
    printf '%s\n' "$publish_dir"
}

start_server() {
    local publish_dir=$1 run_dir=$2
    mkdir -p "$run_dir/data" "$run_dir/filestore"
    (
        cd "$publish_dir"
        exec env \
            ASPNETCORE_ENVIRONMENT=Production \
            ASPNETCORE_URLS="http://127.0.0.1:$PORT" \
            ConnectionStrings__Default="Data Source=$run_dir/data/audios.db" \
            Storage__LocalPath="$run_dir/filestore" \
            Processing__MaxConcurrency="$MAX_CONCURRENCY" \
            Processing__QueueCapacity="$QUEUE_CAPACITY" \
            Summarization__Enabled=false \
            Compression__FfmpegPath="$(command -v ffmpeg)" \
            Logging__LogLevel__Default=Warning \
            dotnet AudioApi.dll >"$run_dir/server.log" 2>&1
    ) &
    SERVER_PID=$!

    local health_deadline=$((SECONDS + 20))
    while ((SECONDS < health_deadline)); do
        if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
            return
        fi
        if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
            sed -n '1,160p' "$run_dir/server.log" >&2 || true
            die 'API exited before becoming healthy'
        fi
        sleep 0.1
    done
    sed -n '1,160p' "$run_dir/server.log" >&2 || true
    die 'API did not become healthy within 20 seconds'
}

stop_server() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
        SERVER_PID=''
    fi
}

json_value() {
    local key=$1 body=$2
    sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$body" | head -1
}

post_one() {
    local index=$1 result_dir=$2 body="$2/body-$1.json" response="$2/post-$1.txt"
    local start_ns end_ns elapsed_ms status
    start_ns=$(date +%s%N)
    curl -sS --max-time "$((POST_SLA_MS / 1000 + 5))" \
        -o "$body" -w '%{http_code}' \
        -F "file=@$FIXTURE;filename=benchmark-$index.wav;type=audio/wav" \
        "http://127.0.0.1:$PORT/api/audios/" > "$response" 2>/dev/null || true
    end_ns=$(date +%s%N)
    status=$(sed -n '1p' "$response" 2>/dev/null || true)
    elapsed_ms=$(awk -v start="$start_ns" -v end="$end_ns" 'BEGIN { printf "%.3f", (end-start)/1000000 }')
    printf '%s\t%s\t%s\n' "$status" "$elapsed_ms" "$(json_value id "$body" 2>/dev/null || true)" > "$result_dir/meta-$index.txt"
}

poll_one() {
    local index=$1 result_dir=$2 id=$3 deadline_ns=$4
    local status='' body="$result_dir/status-$index.json"
    while (( $(date +%s%N) < deadline_ns )); do
        if curl -sS --max-time 2 -o "$body" "http://127.0.0.1:$PORT/api/audios/$id" >/dev/null 2>&1; then
            status=$(json_value processingStatus "$body" || true)
            if [[ "$status" == 'Completed' || "$status" == 'Failed' ]]; then
                printf '%s\n' "$status" > "$result_dir/final-$index.txt"
                return
            fi
        fi
        sleep 0.1
    done
    printf '%s\n' "${status:-Missing}" > "$result_dir/final-$index.txt"
}

percentile_ms() {
    local input=$1 percentile=$2 count
    count=$(wc -l < "$input" | tr -d ' ')
    ((count > 0)) || { printf '0.000\n'; return; }
    awk -v count="$count" -v percentile="$percentile" \
        'BEGIN { target = int((percentile * count) + 0.999999) } NR == target { printf "%.3f\n", $1; exit }' \
        <(sort -n "$input")
}

run_round() {
    local source_label=$1 source_ref=$2 publish_dir=$3 phase=$4 round=$5 users=$6 source_key=$7
    local run_dir="$WORK_ROOT/run-$source_key-$users-$phase-$round" result_dir
    result_dir="$run_dir/results"
    printf 'run source=%s users=%s phase=%s round=%s/%s\n' \
        "$source_label" "$users" "$phase" "$round" "$ROUNDS"
    mkdir -p "$result_dir"
    start_server "$publish_dir" "$run_dir"

    # Warm the upload, EF and ffmpeg path in this exact process. It is excluded from the CSV;
    # the database and file store were still freshly created for this round.
    post_one warmup "$result_dir" || true
    IFS=$'\t' read -r warm_status warm_elapsed warm_id < "$result_dir/meta-warmup.txt" || true
    if [[ "$warm_status" == 201 && -n "$warm_id" ]]; then
        poll_one warmup "$result_dir" "$warm_id" "$(( $(date +%s%N) + TERMINAL_DEADLINE_SECONDS * 1000000000 ))"
    fi

    local round_start_ns deadline_ns end_ns makespan_ms
    local http_201=0 http_429=0 http_503=0 http_other=0
    local terminal=0 completed=0 failed=0 pending=0 processing=0 missing=0
    local -a post_pids=() poll_pids=()
    round_start_ns=$(date +%s%N)
    deadline_ns=$((round_start_ns + TERMINAL_DEADLINE_SECONDS * 1000000000))

    for ((index = 1; index <= users; index++)); do
        post_one "$index" "$result_dir" &
        post_pids+=("$!")
    done
    for pid in "${post_pids[@]}"; do wait "$pid" || true; done

    local post_ms_file="$result_dir/post-ms.txt"
    : > "$post_ms_file"
    for ((index = 1; index <= users; index++)); do
        IFS=$'\t' read -r status elapsed_ms id < "$result_dir/meta-$index.txt" || true
        printf '%s\n' "$elapsed_ms" >> "$post_ms_file"
        case "$status" in
            201)
                ((http_201 += 1))
                if [[ -n "$id" ]]; then
                    poll_one "$index" "$result_dir" "$id" "$deadline_ns" &
                    poll_pids+=("$!")
                else
                    printf 'Missing\n' > "$result_dir/final-$index.txt"
                fi
                ;;
            429) ((http_429 += 1)) ;;
            503) ((http_503 += 1)) ;;
            *) ((http_other += 1)) ;;
        esac
    done
    for pid in "${poll_pids[@]}"; do wait "$pid" || true; done

    for ((index = 1; index <= users; index++)); do
        [[ -f "$result_dir/final-$index.txt" ]] || continue
        status=$(<"$result_dir/final-$index.txt")
        case "$status" in
            Completed) ((completed += 1)); ((terminal += 1)) ;;
            Failed) ((failed += 1)); ((terminal += 1)) ;;
            Pending) ((pending += 1)) ;;
            Processing) ((processing += 1)) ;;
            *) ((missing += 1)) ;;
        esac
    done

    end_ns=$(date +%s%N)
    makespan_ms=$(awk -v start="$round_start_ns" -v end="$end_ns" 'BEGIN { printf "%.3f", (end-start)/1000000 }')
    local post_p50 post_p95 max_post jobs_per_second overload_rejected discard_observation='not-instrumented' criterion='false'
    post_p50=$(percentile_ms "$post_ms_file" 0.50)
    post_p95=$(percentile_ms "$post_ms_file" 0.95)
    max_post=$(sort -n "$post_ms_file" | tail -1)
    jobs_per_second=$(awk -v jobs="$completed" -v ms="$makespan_ms" 'BEGIN { if (ms == 0) print "0.000"; else printf "%.3f", jobs/(ms/1000) }')
    overload_rejected=$((http_429 + http_503))
    # Neither historical source exports a drop counter. Keep this explicitly unobserved instead
    # of manufacturing a zero; terminal/pending states remain independently measured.

    if ((http_201 == users && overload_rejected == 0 && http_other == 0
        && completed == users && failed == 0 && pending == 0 && processing == 0 && missing == 0)) \
        && awk -v p95="$post_p95" -v sla="$POST_SLA_MS" 'BEGIN { exit !(p95 <= sla) }'; then
        criterion='true'
    fi

    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
        "$source_label" "$source_ref" "$MAX_CONCURRENCY" "$QUEUE_CAPACITY" "$phase" "$round" "$users" \
        "$FIXTURE_SHA" "$FIXTURE_BYTES" "$http_201" "$http_429" "$http_503" "$http_other" \
        "$overload_rejected" "$terminal" "$completed" "$failed" "$pending" "$processing" "$missing" \
        "$discard_observation" "$post_p50" "$post_p95" "$max_post" "$makespan_ms" "$jobs_per_second" "$criterion" >> "$OUTPUT"
    LAST_CRITERION=$criterion
    stop_server
}

BEFORE_SOURCE_REF=$BEFORE_REF
AFTER_SOURCE_REF=$(git -C "$AFTER_SOURCE" rev-parse HEAD 2>/dev/null || printf 'working-tree')
if ! git -C "$AFTER_SOURCE" diff --quiet HEAD -- src/AudioApi; then
    AFTER_SOURCE_REF="$AFTER_SOURCE_REF+working-tree"
fi
BEFORE_PUBLISH=$(publish_source "$BEFORE_SOURCE" before)
AFTER_PUBLISH=$(publish_source "$AFTER_SOURCE" after)

printf 'fixture=%s bytes=%s\n' "$FIXTURE_SHA" "$FIXTURE_BYTES"
printf 'before=%s ref=%s\n' "$BEFORE_LABEL" "$BEFORE_SOURCE_REF"
printf 'after=%s ref=%s\n' "$AFTER_LABEL" "$AFTER_SOURCE_REF"
printf 'rounds=%s levels=%s..%s max_concurrency=%s queue_capacity=%s post_sla_ms=%s terminal_deadline_seconds=%s append=%s\n' \
    "$ROUNDS" "$START_USERS" "$MAX_USERS" "$MAX_CONCURRENCY" "$QUEUE_CAPACITY" "$POST_SLA_MS" "$TERMINAL_DEADLINE_SECONDS" "$APPEND"

before_active=true
after_active=true
before_largest_pass='none'
after_largest_pass='none'
before_first_fail='none'
after_first_fail='none'
before_inconclusive='none'
after_inconclusive='none'

for ((users = START_USERS, level_index = 0; users <= MAX_USERS; users *= 2, level_index++)); do
    if [[ "$before_active" == false && "$after_active" == false ]]; then
        break
    fi
    before_base_failed=false
    after_base_failed=false

    for ((round = 1; round <= ROUNDS; round++)); do
        if (((level_index + round) % 2 == 0)); then order=(before after); else order=(after before); fi
        for source_key in "${order[@]}"; do
            if [[ "$source_key" == before && "$before_active" == true ]]; then
                run_round "$BEFORE_LABEL" "$BEFORE_SOURCE_REF" "$BEFORE_PUBLISH" sample "$round" "$users" before
                [[ "$LAST_CRITERION" == true ]] || before_base_failed=true
            elif [[ "$source_key" == after && "$after_active" == true ]]; then
                run_round "$AFTER_LABEL" "$AFTER_SOURCE_REF" "$AFTER_PUBLISH" sample "$round" "$users" after
                [[ "$LAST_CRITERION" == true ]] || after_base_failed=true
            fi
        done
    done

    if [[ "$before_active" == true ]]; then
        if [[ "$before_base_failed" == false ]]; then
            before_largest_pass=$users
        else
            run_round "$BEFORE_LABEL" "$BEFORE_SOURCE_REF" "$BEFORE_PUBLISH" confirmation "$((ROUNDS + 1))" "$users" before
            if [[ "$LAST_CRITERION" == false ]]; then
                before_first_fail=$users
                before_active=false
            else
                before_inconclusive=$users
            fi
        fi
    fi
    if [[ "$after_active" == true ]]; then
        if [[ "$after_base_failed" == false ]]; then
            after_largest_pass=$users
        else
            run_round "$AFTER_LABEL" "$AFTER_SOURCE_REF" "$AFTER_PUBLISH" confirmation "$((ROUNDS + 1))" "$users" after
            if [[ "$LAST_CRITERION" == false ]]; then
                after_first_fail=$users
                after_active=false
            else
                after_inconclusive=$users
            fi
        fi
    fi
done

printf 'before_largest_pass=%s before_first_confirmed_fail=%s before_inconclusive=%s\n' \
    "$before_largest_pass" "$before_first_fail" "$before_inconclusive"
printf 'after_largest_pass=%s after_first_confirmed_fail=%s after_inconclusive=%s\n' \
    "$after_largest_pass" "$after_first_fail" "$after_inconclusive"
printf 'csv=%s\n' "$OUTPUT"
