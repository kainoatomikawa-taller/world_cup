import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFixtures, type StaticFixture } from '../../data/useFixtures';
import { useMatchDetail } from '../../data/useMatchDetail';

const STAGE_ORDER: Record<string, number> = {
  group: 0,
  round32: 1,
  round16: 2,
  quarter: 3,
  semi: 4,
  thirdPlacePlayoff: 5,
  final: 6,
};

const KNOCKOUT_LABEL: Record<string, string> = {
  round32: 'Round of 32',
  round16: 'Round of 16',
  quarter: 'Quarter-finals',
  semi: 'Semi-finals',
  thirdPlacePlayoff: 'Third-Place Play-off',
  final: 'Final',
};

function formatDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatKickoff(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Match-day grouping
// ---------------------------------------------------------------------------

interface MatchDay {
  date: string;
  label: string;
  items: StaticFixture[];
}

function groupIntoMatchDays(fixtures: StaticFixture[]): MatchDay[] {
  const sorted = [...fixtures].sort((a, b) => {
    const stageDiff = (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99);
    if (stageDiff !== 0) return stageDiff;
    return a.kickoff.localeCompare(b.kickoff);
  });
  const map = new Map<string, MatchDay>();
  for (const f of sorted) {
    const date = f.kickoff.slice(0, 10);
    if (!map.has(date)) {
      map.set(date, { date, label: formatDateLabel(date), items: [] });
    }
    map.get(date)!.items.push(f);
  }
  return Array.from(map.values());
}

function defaultDayIndex(days: MatchDay[]): number {
  if (days.length === 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayIdx = days.findIndex((d) => d.date === today);
  if (todayIdx !== -1) return todayIdx;
  const nextIdx = days.findIndex((d) => d.date > today);
  if (nextIdx !== -1) return nextIdx;
  const finalIdx = days.findLastIndex((d) => d.items.some((f) => f.stage === 'final'));
  if (finalIdx !== -1) return finalIdx;
  return days.length - 1;
}

// ---------------------------------------------------------------------------
// Match detail panel — lazy-loaded on row click
// ---------------------------------------------------------------------------

function MatchDetailPanel({ matchId }: { matchId: string }) {
  const { detail, loading, error } = useMatchDetail(matchId);

  if (loading) return <div className="match-detail match-detail--loading">Loading…</div>;
  if (error) return <div className="match-detail match-detail--error">Could not load detail.</div>;
  if (!detail) return null;

  return (
    <div className="match-detail">
      <dl className="match-detail__grid">
        <dt>Kickoff</dt>
        <dd>
          {new Date(detail.kickoff).toLocaleString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
          })}
        </dd>
        {detail.group_id && (
          <>
            <dt>Group</dt>
            <dd>{detail.group_id}</dd>
          </>
        )}
        <dt>Stage</dt>
        <dd>{KNOCKOUT_LABEL[detail.stage] ?? detail.stage}</dd>
        {detail.played === 1 && (
          <>
            <dt>Result</dt>
            <dd className="tnum">
              {detail.home_team} {detail.home_goals ?? 0} – {detail.away_goals ?? 0} {detail.away_team}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixture row — clickable, expands detail panel
// ---------------------------------------------------------------------------

function FixtureRow({
  fixture: f,
  selected,
  onToggle,
}: {
  fixture: StaticFixture;
  selected: boolean;
  onToggle: () => void;
}) {
  const played = f.played === 1;
  return (
    <div className={`fixture-row-wrap${selected ? ' fixture-row-wrap--open' : ''}`}>
      <button
        className={`fixture-row fixture-row--btn${played ? ' fixture-row--played' : ''}`}
        onClick={onToggle}
        aria-expanded={selected}
      >
        <span className="fixture-team fixture-team--home">
          <span className="fixture-team__flag">{f.home_flag}</span>
          <span className="fixture-team__name">{f.home_team}</span>
        </span>

        <span className="fixture-center tnum">
          {f.group_id && (
            <span className="group-badge fixture-group-badge">{f.group_id}</span>
          )}
          <span className="fixture-score">
            {played
              ? `${f.home_goals ?? 0} – ${f.away_goals ?? 0}`
              : formatKickoff(f.kickoff)}
          </span>
        </span>

        <span className="fixture-team fixture-team--away">
          <span className="fixture-team__name">{f.away_team}</span>
          <span className="fixture-team__flag">{f.away_flag}</span>
        </span>
      </button>

      {selected && <MatchDetailPanel matchId={f.match_id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixtures screen — match-day browser
// ---------------------------------------------------------------------------

export function Fixtures() {
  const { fixtures, loading, error } = useFixtures();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const initialized = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const matchDays = useMemo(() => groupIntoMatchDays(fixtures), [fixtures]);

  // Set default day once data arrives
  useEffect(() => {
    if (matchDays.length > 0 && !initialized.current) {
      initialized.current = true;
      setDayIndex(defaultDayIndex(matchDays));
    }
  }, [matchDays]);

  // Clear selected row when day changes
  useEffect(() => {
    setSelectedId(null);
  }, [dayIndex]);

  const goPrev = useCallback(() => setDayIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setDayIndex((i) => Math.min(matchDays.length - 1, i + 1)),
    [matchDays.length],
  );

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  if (loading) {
    return <p className="screen-intro">Loading fixtures…</p>;
  }

  if (error) {
    return (
      <p className="screen-intro">
        Could not load fixtures ({error}). Please try again later.
      </p>
    );
  }

  if (matchDays.length === 0) {
    return <p className="screen-intro">No fixtures available yet.</p>;
  }

  const current = matchDays[dayIndex];
  const atStart = dayIndex === 0;
  const atEnd = dayIndex === matchDays.length - 1;

  function toggle(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div
      className="matchday-browser"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="matchday-nav">
        <button
          className="matchday-nav__btn"
          onClick={goPrev}
          disabled={atStart}
          aria-label="Previous match day"
        >
          ←
        </button>

        <div className="matchday-nav__center">
          <span className="matchday-nav__date">{current.label}</span>
          <span className="matchday-nav__counter">
            {dayIndex + 1} / {matchDays.length}
          </span>
        </div>

        <button
          className="matchday-nav__btn"
          onClick={goNext}
          disabled={atEnd}
          aria-label="Next match day"
        >
          →
        </button>
      </div>

      <div className="card fixture-list matchday-card-list">
        {current.items.map((f) => (
          <FixtureRow
            key={f.match_id}
            fixture={f}
            selected={selectedId === f.match_id}
            onToggle={() => toggle(f.match_id)}
          />
        ))}
      </div>
    </div>
  );
}
