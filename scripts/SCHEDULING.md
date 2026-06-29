# Ingest Scheduling

The data pipeline runs in three sequential stages scheduled externally.
The app never triggers ingestion — it only reads from `db/world_cup.db` and
`public/data/*.json`.

| Script | Writes to | Typical run time |
|---|---|---|
| `ingest_api.py` | `competitions`, `teams`, `matches`, `standings`, `scorers` (SQLite) | ~35 s (5 rate-limited API calls) |
| `ingest_stats.py` | `player_stats`, `player_ratings` (SQLite) | 5–15 min (Selenium scraping) |
| `export_json.py` | `export/*.json`, `public/data/*.json` (read-only; no DB writes) | ~1 s |

The ingest scripts write through SQLite WAL-mode upserts, so a partial or
failed run leaves the existing rows intact.  `export_json.py` writes all files
atomically (write to `.tmp`, then rename), so a crash mid-export leaves the
previous `public/data/` files intact.

---

## Wrapper script

`scripts/run_ingest.sh` runs all three scripts in sequence and handles:

- **Overlap prevention** — a PID file blocks a second run if one is already in
  progress (safe for cron jitter or manual re-runs).
- **Logging** — all stdout and stderr from all scripts is appended to
  `logs/ingest.log` with UTC timestamps.
- **Failure isolation** — if an earlier script fails, later ones still run.
  The wrapper exits non-zero only when at least one script failed.
- **Log rotation** — when `logs/ingest.log` exceeds 10 MB the file is trimmed
  to the last 5 000 lines.

The `logs/` directory is git-ignored.

```
bash scripts/run_ingest.sh           # normal run
bash scripts/run_ingest.sh --dry-run # pass --dry-run to the ingest scripts
                                     # export_json.py always runs (read-only)
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
| `export_json.py` crash mid-write | All `public/data/` files stay at last-good state (atomic tmp→rename) | `export_json.py: FAILED (exit …)` |
| Concurrent run attempted | Second invocation exits immediately | `SKIP: already running (PID …)` |

---

## Object-storage upgrade (recommended next step)

The current pipeline writes JSON to `public/data/` so the Vite dev server and
production build can serve the files as static assets.  This couples every data
refresh to a frontend redeploy.

**Recommended upgrade:** upload the `export/` files to a CDN bucket (S3,
Cloudflare R2, or GCS) instead of, or in addition to, copying to `public/data/`.

### What changes

| Layer | Current | With object storage |
|---|---|---|
| `export_json.py` | calls `_sync_frontend()` to copy to `public/data/` | also uploads each file to `s3://bucket/data/<file>` (or equivalent) |
| Frontend `useFixtures` hook | fetches `/data/fixtures.json` (same origin) | fetches `https://cdn.example.com/data/fixtures.json` |
| Cache-busting | Vite content-hash on the HTML bundle | `manifest.json`'s `content_hash` as a query param: `fixtures.json?v=<hash>` |
| Freshness | On every frontend redeploy | On every ingest run, independently of any deploy |

### Why it's worth doing

- **Decouples data from deploys** — a score update publishes in ~1 s of upload
  time; no rebuild or Vercel/Netlify deploy needed.
- **Scales to many readers** — CDN edge nodes serve the JSON; the origin server
  carries no read traffic.
- **No schema change** — the JSON shape and `manifest.json` format are stable.
  The front-end only needs a base-URL environment variable changed.

### How to wire it up

1. Add `boto3` (S3/R2) or `google-cloud-storage` (GCS) to `requirements.txt`.
2. Add an `--upload` flag to `export_json.py` (or a separate `upload_cdn.py`)
   that iterates `_FRONTEND_FILES` plus `matches/` and uploads each one.
3. Set CDN credentials in `.env.local` (never in source).
4. In `run_ingest.sh`, replace or supplement the `export_json.py` call with
   one that passes `--upload`.
5. Point the frontend `VITE_DATA_BASE_URL` env var at the CDN bucket URL.

The `export/` staging directory and the atomic write guarantees already in
place mean the upload step can be bolted on without reworking the rest of
the pipeline.
