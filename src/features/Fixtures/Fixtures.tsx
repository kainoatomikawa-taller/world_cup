import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFixtures, type StaticFixture } from '../../data/useFixtures';
import { useStandings, type StaticStanding } from '../../data/useStandings';
import { useTournamentStore } from '../../store/tournamentStore';
import { stageLabel } from '../../domain/teamRecord';
import { resolveCity } from '../../domain/venueCity';
import type { Stage, GroupId } from '../../domain/types';

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

function formatFullKickoff(isoStr: string): string {
  const d = new Date(isoStr);
  const date = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// ---------------------------------------------------------------------------
// Match-day grouping (browser view)
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
// Full-schedule grouping
// Group-stage matches bucket by calendar date; knockout by stage name.
// ---------------------------------------------------------------------------

interface ScheduleGroup {
  key: string;
  label: string;
  items: StaticFixture[];
}

function groupForSchedule(fixtures: StaticFixture[]): ScheduleGroup[] {
  const sorted = [...fixtures].sort((a, b) => {
    const stageDiff = (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99);
    if (stageDiff !== 0) return stageDiff;
    return a.kickoff.localeCompare(b.kickoff);
  });
  const map = new Map<string, ScheduleGroup>();
  for (const f of sorted) {
    let key: string;
    let label: string;
    if (f.stage === 'group') {
      const date = f.kickoff.slice(0, 10);
      key = `date:${date}`;
      label = formatDateLabel(date);
    } else {
      key = `stage:${f.stage}`;
      label = KNOCKOUT_LABEL[f.stage] ?? f.stage;
    }
    if (!map.has(key)) {
      map.set(key, { key, label, items: [] });
    }
    map.get(key)!.items.push(f);
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Fixture card — compact row with expandable detail strip.
// Played matches → main area is a clickable button → openMatchDetail.
// Expand toggle (▾/▴) reveals venue+city, full kickoff, and W-D-L records.
// ---------------------------------------------------------------------------

function FixtureRow({
  fixture: f,
  onOpen,
  standingsMap,
}: {
  fixture: StaticFixture;
  onOpen: () => void;
  standingsMap: Map<string, StaticStanding>;
}) {
  const [expanded, setExpanded] = useState(false);
  const played = f.played === 1;
  const homeTbd = !f.home_team;
  const awayTbd = !f.away_team;
  const anyTbd = homeTbd || awayTbd;

  const chip = stageLabel(f.stage as Stage, f.group_id as GroupId | undefined);
  const city = resolveCity(f.venue ?? undefined);

  const homeStanding = f.group_id
    ? standingsMap.get(`${f.home_code}:${f.group_id}`)
    : undefined;
  const awayStanding = f.group_id
    ? standingsMap.get(`${f.away_code}:${f.group_id}`)
    : undefined;

  const mainContent = (
    <>
      <span className={`fixture-team fixture-team--home${homeTbd ? ' fixture-team--tbd' : ''}`}>
        {!homeTbd && <span className="fixture-team__flag">{f.home_flag}</span>}
        <span className="fixture-team__name">{homeTbd ? 'TBD' : f.home_team}</span>
      </span>

      <span className="fixture-center tnum">
        <span className="fixture-chip">{chip}</span>
        <span className="fixture-score">
          {played
            ? `${f.home_goals ?? 0} – ${f.away_goals ?? 0}`
            : formatKickoff(f.kickoff)}
        </span>
      </span>

      <span className={`fixture-team fixture-team--away${awayTbd ? ' fixture-team--tbd' : ''}`}>
        <span className="fixture-team__name">{awayTbd ? 'TBD' : f.away_team}</span>
        {!awayTbd && <span className="fixture-team__flag">{f.away_flag}</span>}
      </span>
    </>
  );

  return (
    <div className="fixture-row-wrap">
      <div className="fixture-row-inner">
        {played ? (
          <button
            className="fixture-row fixture-row--btn fixture-row--played"
            onClick={onOpen}
          >
            {mainContent}
          </button>
        ) : (
          <div className={`fixture-row${anyTbd ? ' fixture-row--tbd' : ' fixture-row--upcoming'}`}>
            {mainContent}
          </div>
        )}
        <button
          className={`fixture-expand-btn${expanded ? ' fixture-expand-btn--open' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse match details' : 'Show match details'}
          aria-expanded={expanded}
        >
          ▾
        </button>
      </div>

      {expanded && (
        <div className="fixture-detail">
          <div className="fixture-detail__venue">
            {f.venue ? (
              <>
                <span className="fixture-detail__venue-name">{f.venue}</span>
                {city && (
                  <span className="fixture-detail__city"> · {city}</span>
                )}
              </>
            ) : (
              <span className="fixture-detail__placeholder">Venue TBD</span>
            )}
          </div>

          <div className="fixture-detail__kickoff">
            {formatFullKickoff(f.kickoff)}
          </div>

          {(homeStanding || awayStanding) && (
            <div className="fixture-detail__records">
              <span className="fixture-detail__record fixture-detail__record--home">
                {!homeTbd && (
                  <span className="fixture-team__flag">{f.home_flag}</span>
                )}
                {homeStanding ? (
                  <>
                    <span>
                      W{homeStanding.won} D{homeStanding.drawn} L{homeStanding.lost}
                    </span>
                    {homeStanding.position != null && (
                      <span className="fixture-detail__pos">
                        {ordinal(homeStanding.position)}
                      </span>
                    )}
                  </>
                ) : (
                  <span>—</span>
                )}
              </span>

              <span className="fixture-detail__record fixture-detail__record--away">
                {awayStanding ? (
                  <>
                    {awayStanding.position != null && (
                      <span className="fixture-detail__pos">
                        {ordinal(awayStanding.position)}
                      </span>
                    )}
                    <span>
                      W{awayStanding.won} D{awayStanding.drawn} L{awayStanding.lost}
                    </span>
                  </>
                ) : (
                  <span>—</span>
                )}
                {!awayTbd && (
                  <span className="fixture-team__flag">{f.away_flag}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-schedule screen
// ---------------------------------------------------------------------------

function FullSchedule({
  fixtures,
  onBack,
  onOpen,
  standingsMap,
}: {
  fixtures: StaticFixture[];
  onBack: () => void;
  onOpen: (matchId: string) => void;
  standingsMap: Map<string, StaticStanding>;
}) {
  const groups = useMemo(() => groupForSchedule(fixtures), [fixtures]);

  return (
    <div className="full-schedule">
      <button className="schedule-back-btn" onClick={onBack}>
        ← Match-day view
      </button>

      <div className="full-schedule__sections">
        {groups.map((group) => (
          <section key={group.key} className="schedule-section">
            <h2 className="fixture-group__label">{group.label}</h2>
            <div className="card fixture-list">
              {group.items.map((f) => (
                <FixtureRow
                  key={f.match_id}
                  fixture={f}
                  onOpen={() => onOpen(f.match_id)}
                  standingsMap={standingsMap}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixtures tab — match-day browser with link to full schedule
// ---------------------------------------------------------------------------

export function Fixtures() {
  const { fixtures, loading, error } = useFixtures();
  const { standings } = useStandings();
  const openMatchDetail = useTournamentStore((s) => s.openMatchDetail);
  const [view, setView] = useState<'browser' | 'schedule'>('browser');
  const [dayIndex, setDayIndex] = useState(0);
  const initialized = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const matchDays = useMemo(() => groupIntoMatchDays(fixtures), [fixtures]);

  // Build lookup: "CODE:GROUP_ID" → StaticStanding (for group-stage records)
  const standingsMap = useMemo(() => {
    const map = new Map<string, StaticStanding>();
    for (const s of standings) {
      map.set(`${s.code}:${s.group_id}`, s);
    }
    return map;
  }, [standings]);

  // Set default day once data arrives
  useEffect(() => {
    if (matchDays.length > 0 && !initialized.current) {
      initialized.current = true;
      setDayIndex(defaultDayIndex(matchDays));
    }
  }, [matchDays]);

  const goPrev = useCallback(() => setDayIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setDayIndex((i) => Math.min(matchDays.length - 1, i + 1)),
    [matchDays.length],
  );

  // Keyboard navigation — only active in browser view
  useEffect(() => {
    if (view !== 'browser') return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [view, goPrev, goNext]);

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

  if (view === 'schedule') {
    return (
      <FullSchedule
        fixtures={fixtures}
        onBack={() => setView('browser')}
        onOpen={openMatchDetail}
        standingsMap={standingsMap}
      />
    );
  }

  const current = matchDays[dayIndex];
  const atStart = dayIndex === 0;
  const atEnd = dayIndex === matchDays.length - 1;

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
            onOpen={() => openMatchDetail(f.match_id)}
            standingsMap={standingsMap}
          />
        ))}
      </div>

      <div className="matchday-schedule-link">
        <button
          className="matchday-schedule-link__btn"
          onClick={() => setView('schedule')}
        >
          View full schedule ›
        </button>
      </div>
    </div>
  );
}
