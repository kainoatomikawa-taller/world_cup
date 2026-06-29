#!/usr/bin/env bash
# run_news.sh — hourly wrapper: ingest_news.py + export_json.py.
#
# Runs only the RSS-feed ingest and JSON export — skips the slower API and
# stats ingests.  Designed to run every hour from launchd or cron while the
# full run_ingest.sh continues on its twice-daily schedule.
#
# Behaviour:
#   • Prevents concurrent runs via a dedicated PID file (news.pid).
#   • Appends output to the shared logs/ingest.log.
#   • Trims the log when it exceeds 10 MB.
#   • Exits 0 on full success; exits with failure count otherwise.
#
# Usage:
#   bash scripts/run_news.sh
#   bash scripts/run_news.sh --dry-run

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$REPO_ROOT/scripts/.venv/bin/python"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/ingest.log"
PID_FILE="$LOG_DIR/news.pid"
LOG_MAX_BYTES=10485760   # rotate when log exceeds 10 MB

DRY_RUN_FLAG=""
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN_FLAG="--dry-run"
fi

mkdir -p "$LOG_DIR"

ts()  { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }

if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
        log "SKIP [news]: already running (PID $old_pid) — exiting"
        exit 0
    fi
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT INT TERM

if [ ! -x "$PYTHON" ]; then
    log "ERROR: Python venv not found at $PYTHON"
    exit 1
fi

failures=0

log "════ news ingest start ════"

# shellcheck disable=SC2086
if "$PYTHON" "$REPO_ROOT/scripts/ingest_news.py" $DRY_RUN_FLAG >> "$LOG_FILE" 2>&1; then
    log "ingest_news.py: OK"
else
    rc=$?
    log "ingest_news.py: FAILED (exit $rc)"
    failures=$((failures + 1))
fi

# Cluster articles after ingest so cluster_id and entities are written to the
# database before export_json.py reads from the news table.
# shellcheck disable=SC2086
if "$PYTHON" "$REPO_ROOT/scripts/cluster_news.py" $DRY_RUN_FLAG >> "$LOG_FILE" 2>&1; then
    log "cluster_news.py: OK"
else
    rc=$?
    log "cluster_news.py: FAILED (exit $rc)"
    failures=$((failures + 1))
fi

if "$PYTHON" "$REPO_ROOT/scripts/export_json.py" >> "$LOG_FILE" 2>&1; then
    log "export_json.py: OK"
else
    rc=$?
    log "export_json.py: FAILED (exit $rc)"
    failures=$((failures + 1))
fi

if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "$LOG_MAX_BYTES" ]; then
    tmp=$(mktemp)
    tail -n 5000 "$LOG_FILE" > "$tmp" && mv "$tmp" "$LOG_FILE"
    log "log rotated (kept last 5 000 lines)"
fi

log "════ news ingest done — $failures failure(s) ════"
exit "$failures"
