#!/usr/bin/env bash
# run_ingest.sh — sequential wrapper for ingest_api.py and ingest_stats.py.
#
# Safe to call from cron or launchd:
#   • Prevents concurrent runs via a PID file.
#   • Captures all script output (stdout + stderr) to logs/ingest.log.
#   • Runs both scripts even if the first one fails.
#   • Trims the log file to 5 000 lines when it exceeds 10 MB.
#   • Exits 0 when both succeed; exits with the count of failures otherwise.
#
# The data store is safe across failures: both ingest scripts write via
# SQLite WAL-mode upserts, so a crash mid-run leaves the existing rows intact.
#
# Usage:
#   bash scripts/run_ingest.sh
#   bash scripts/run_ingest.sh --dry-run   # passes --dry-run to both scripts

set -uo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$REPO_ROOT/scripts/.venv/bin/python"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/ingest.log"
PID_FILE="$LOG_DIR/ingest.pid"
LOG_MAX_BYTES=10485760   # rotate when log exceeds 10 MB

DRY_RUN_FLAG=""
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN_FLAG="--dry-run"
fi

mkdir -p "$LOG_DIR"

# ── Helpers ───────────────────────────────────────────────────────────────────

ts()  { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }

# ── Prevent overlapping runs ──────────────────────────────────────────────────

if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
        log "SKIP: already running (PID $old_pid) — exiting"
        exit 0
    fi
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT INT TERM

# ── Sanity check ──────────────────────────────────────────────────────────────

if [ ! -x "$PYTHON" ]; then
    log "ERROR: Python venv not found at $PYTHON"
    log "       Run: cd scripts && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
fi

# ── Run scripts ───────────────────────────────────────────────────────────────

failures=0

log "════ ingest start ════"

# backbone tables: competitions, teams, matches, standings, scorers
log "── ingest_api.py $DRY_RUN_FLAG ──"
# shellcheck disable=SC2086
if "$PYTHON" "$REPO_ROOT/scripts/ingest_api.py" $DRY_RUN_FLAG >> "$LOG_FILE" 2>&1; then
    log "ingest_api.py: OK"
else
    rc=$?
    log "ingest_api.py: FAILED (exit $rc) — existing store rows are unaffected"
    failures=$((failures + 1))
fi

# enrichment tables: player_stats, player_ratings
log "── ingest_stats.py $DRY_RUN_FLAG ──"
# shellcheck disable=SC2086
if "$PYTHON" "$REPO_ROOT/scripts/ingest_stats.py" $DRY_RUN_FLAG >> "$LOG_FILE" 2>&1; then
    log "ingest_stats.py: OK"
else
    rc=$?
    log "ingest_stats.py: FAILED (exit $rc) — backbone tables are unaffected"
    failures=$((failures + 1))
fi

# static JSON for the front-end (export/ → public/data/)
log "── export_json.py ──"
if "$PYTHON" "$REPO_ROOT/scripts/export_json.py" >> "$LOG_FILE" 2>&1; then
    log "export_json.py: OK"
else
    rc=$?
    log "export_json.py: FAILED (exit $rc) — existing static assets are unaffected"
    failures=$((failures + 1))
fi

# ── Log rotation ──────────────────────────────────────────────────────────────

if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "$LOG_MAX_BYTES" ]; then
    tmp=$(mktemp)
    tail -n 5000 "$LOG_FILE" > "$tmp" && mv "$tmp" "$LOG_FILE"
    log "log rotated (kept last 5 000 lines)"
fi

log "════ ingest done — $failures failure(s) ════"
exit "$failures"
