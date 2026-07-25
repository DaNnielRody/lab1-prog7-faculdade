#!/bin/sh
set -eu

PORT="${SMOKE_PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
DEADLINE=90
APP_LOG=/tmp/smoke-app.log

export ASPNETCORE_URLS="http://+:${PORT}"

http_status() {
    STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null) || STATUS=000
    [ -n "$STATUS" ] || STATUS=000
    printf '%s' "$STATUS"
}

dotnet run --project src/AudioApi -c Release --no-build --no-launch-profile > "$APP_LOG" 2>&1 &
APP_PID=$!

dump_log() {
    echo "smoke: ---- application output ----"
    tail -n 40 "$APP_LOG" 2>/dev/null || echo "smoke: no output captured"
    echo "smoke: -----------------------------"
}

cleanup() {
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "smoke: waiting up to ${DEADLINE}s for ${BASE}/health"

READY=0
i=0
while [ "$i" -lt "$DEADLINE" ]; do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
        echo "smoke: FAIL - the application exited before becoming reachable"
        dump_log
        exit 1
    fi

    STATUS=$(http_status "${BASE}/health")
    if [ "$STATUS" != "000" ] && [ "$STATUS" -lt 500 ]; then
        echo "smoke: /health -> ${STATUS} after ${i}s"
        READY=1
        break
    fi

    i=$((i + 1))
    sleep 1
done

if [ "$READY" -ne 1 ]; then
    echo "smoke: FAIL - ${BASE}/health never answered under 500 within ${DEADLINE}s"
    dump_log
    exit 1
fi

FAILED=0

for ROUTE in /health /api/audios; do
    STATUS=$(http_status "${BASE}${ROUTE}")
    echo "smoke: GET ${ROUTE} -> ${STATUS}"
    if [ "$STATUS" = "000" ] || [ "$STATUS" -ge 500 ]; then
        FAILED=1
    fi
done

STATUS=$(http_status "${BASE}/api/audios/00000000-0000-0000-0000-000000000000/summary")
echo "smoke: GET /api/audios/{unknown}/summary -> ${STATUS} (404 expected)"
if [ "$STATUS" != "404" ]; then
    FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
    echo "smoke: FAIL"
    dump_log
    exit 1
fi

echo "smoke: OK"
