#!/usr/bin/env bash

set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

MODE="${1:-local}"
APP_PID=""
NGROK_PID=""

cleanup() {
    if [[ -n "$NGROK_PID" ]]; then
        kill "$NGROK_PID" 2>/dev/null || true
    fi
    if [[ -n "$APP_PID" ]]; then
        kill "$APP_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

run_golden_smoke() {
    echo "Running the guarded golden-dataset smoke test..."
    LANGSMITH_CAPTURE_CONTENT=false python run_langsmith_smoke.py
}

start_services() {
    if [[ ! -f ".venv/bin/activate" ]]; then
        echo "Missing .venv. Create the virtual environment first." >&2
        exit 1
    fi
    if ! command -v ngrok >/dev/null 2>&1; then
        echo "ngrok is not installed or is not on PATH." >&2
        exit 1
    fi

    source .venv/bin/activate
    python app.py &
    APP_PID=$!
    sleep 2
    if ! kill -0 "$APP_PID" 2>/dev/null; then
        echo "The application did not start." >&2
        exit 1
    fi

    echo "Application: http://127.0.0.1:8001"
    echo "Starting ngrok for port 8001..."
    ngrok http 8001 &
    NGROK_PID=$!
    sleep 2
    if ! kill -0 "$NGROK_PID" 2>/dev/null; then
        echo "ngrok did not start. Stop any existing ngrok tunnel and try again." >&2
        exit 1
    fi
    echo "Keep this terminal open. Use the ngrok URL plus /webhooks/slack in Slack."
}

case "$MODE" in
    local|live)
        start_services
        wait "$NGROK_PID" || true
        ;;
    golden-smoke|smoke)
        source .venv/bin/activate
        run_golden_smoke
        ;;
    all)
        start_services
        set +e
        run_golden_smoke
        SMOKE_STATUS=$?
        set -e
        if [[ "$SMOKE_STATUS" -ne 0 ]]; then
            echo "Golden smoke test failed; do not start the 50-case evaluation." >&2
        fi
        echo "Live application and ngrok remain running. Press Ctrl+C to stop them."
        wait "$NGROK_PID" || true
        ;;
    help|--help|-h)
        echo "Usage: ./start_local.sh [local|golden-smoke|all]"
        echo "  local          Start the application and ngrok (default)."
        echo "  golden-smoke   Run the guarded three-case golden-dataset smoke test."
        echo "  all            Start the application, ngrok, and golden smoke test."
        ;;
    *)
        echo "Unknown mode: $MODE" >&2
        echo "Usage: ./start_local.sh [local|golden-smoke|all]" >&2
        exit 2
        ;;
esac
