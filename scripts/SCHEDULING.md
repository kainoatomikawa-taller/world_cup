# Ingest Scheduling

The data pipeline consists of two scripts that must be scheduled externally.
The app never triggers ingestion — it only reads from `db/world_cup.db`.

| Script | Tables written | Typical run time |
|---|---|---|
| `ingest_api.py` | `competitions`, `teams`, `matches`, `standings`, `scorers` | ~35 s (5 rate-limited API calls) |
| `ingest_stats.py` | `player_stats`, `player_ratings` | 5–15 min (Selenium scraping) |

Both scripts write through SQLite WAL-mode upserts, so a partial or failed
run leaves the existing rows intact.

---

## Wrapper script

`scripts/run_ingest.sh` runs both scripts in sequence and handles:

- **Overlap prevention** — a PID file blocks a second run if one is already in
  progress (safe for cron jitter or manual re-runs).
- **Logging** — all stdout and stderr from both scripts is appended to
  `logs/ingest.log` with UTC timestamps.
- **Failure isolation** — if `ingest_api.py` fails, `ingest_stats.py` still
  runs. The wrapper exits non-zero only when at least one script failed.
- **Log rotation** — when `logs/ingest.log` exceeds 10 MB the file is trimmed
  to the last 5 000 lines.

The `logs/` directory is git-ignored.

```
bash scripts/run_ingest.sh          # normal run
bash scripts/run_ingest.sh --dry-run  # pass --dry-run to both scripts
```

---

## Option A — cron (cross-platform)

Open your crontab:

```
crontab -e
```

Add these two lines (adjust the absolute path to match where this repo lives):

```cron
# World Cup Insights — run at 07:00 and 19:00 UTC every day
0  7 * * *  /absolute/path/to/scripts/run_ingest.sh
0 19 * * *  /absolute/path/to/scripts/run_ingest.sh
```

> **Note** — cron on macOS requires "Full Disk Access" for the Terminal (or
> whichever app hosts cron) in System Settings → Privacy & Security.

Verify the cron job was registered:

```
crontab -l
```

To check results after the first run:

```
tail -f logs/ingest.log
```

---

## Option B — launchd (macOS, recommended)

launchd is more reliable than cron on macOS: it catches up missed runs after
sleep/wake and integrates with the system log.

**One-time setup:**

1. Edit `scripts/launchd/com.world-cup-insights.ingest.plist` and replace
   every occurrence of `REPO_ROOT` with the absolute path to this repository:

   ```
   sed -i '' "s|REPO_ROOT|$(pwd)|g" \
     scripts/launchd/com.world-cup-insights.ingest.plist
   ```

2. Copy to the LaunchAgents folder and load it:

   ```
   cp scripts/launchd/com.world-cup-insights.ingest.plist \
      ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.world-cup-insights.ingest.plist
   ```

3. Confirm it is registered:

   ```
   launchctl list | grep world-cup
   ```

**Adjusting the schedule:**

Edit the `StartCalendarInterval` entries in the plist (times are in local
machine time), then reload:

```
launchctl unload ~/Library/LaunchAgents/com.world-cup-insights.ingest.plist
launchctl load   ~/Library/LaunchAgents/com.world-cup-insights.ingest.plist
```

**Uninstall:**

```
launchctl unload ~/Library/LaunchAgents/com.world-cup-insights.ingest.plist
rm ~/Library/LaunchAgents/com.world-cup-insights.ingest.plist
```

---

## Reading logs

```bash
# Live tail
tail -f logs/ingest.log

# Last run only
awk '/════ ingest start/,/════ ingest done/' logs/ingest.log | tail -50

# All failures
grep "FAILED\|ERROR" logs/ingest.log
```

---

## Adjusting frequency

Edit the `StartCalendarInterval` block in the plist (launchd) or the crontab
expression (cron).  Guidelines:

- **Twice daily** (07:00 + 19:00 local) works well during a live tournament —
  results from overnight matches are available by morning, and the evening run
  catches afternoon/evening games.
- **Once daily** (06:00 UTC) is sufficient for the stats enrichment sources
  (FBref/Understat publish aggregate stats once a day).
- **Off-season**: a single daily run at any quiet hour is fine.

The schedule of `ingest_stats.py` can be made independent by splitting the
wrapper call into two separate cron/launchd entries — one calling
`python scripts/ingest_api.py` directly and another calling
`python scripts/ingest_stats.py`.

---

## Failure isolation summary

| Failure mode | Effect on store | Evidence in log |
|---|---|---|
| API key missing or invalid | `ingest_api.py` exits non-zero; no rows changed | `ERROR: FOOTBALL_API_KEY not set` |
| Network error mid-run | Rows already committed are kept; in-flight batch rolled back by WAL | `FAILED (exit …)` |
| FBref Selenium timeout | FBref rows missing; backbone tables unaffected | `[FBref] ERROR` |
| Understat tls-client missing | Understat skipped; everything else proceeds | `SKIP: Understat requires…` |
| Concurrent run attempted | Second invocation exits immediately | `SKIP: already running (PID …)` |
