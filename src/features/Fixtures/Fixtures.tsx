import { useState } from 'react';
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

interface FixtureGroup {
  label: string;
  items: StaticFixture[];
}

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

function groupByDateOrStage(fixtures: StaticFixture[]): FixtureGroup[] {
  const sorted = [...fixtures].sort((a, b) => {
    const stageDiff =
      (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99);
    if (stageDiff !== 0) return stageDiff;
    return a.kickoff.localeCompare(b.kickoff);
  });

  const map = new Map<string, FixtureGroup>();
  for (const f of sorted) {
    let key: string;
    let label: string;
    if (f.stage === 'group') {
      const dateStr = f.kickoff.slice(0, 10);
      key = `date:${dateStr}`;
      label = formatDateLabel(dateStr);
    } else {
      key = `stage:${f.stage}`;
      label = KNOCKOUT_LABEL[f.stage] ?? f.stage;
    }
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key)!.items.push(f);
  }
  return Array.from(map.values());
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
// Fixtures screen
// ---------------------------------------------------------------------------

export function Fixtures() {
  const { fixtures, loading, error } = useFixtures();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const groups = groupByDateOrStage(fixtures);

  if (groups.length === 0) {
    return <p className="screen-intro">No fixtures available yet.</p>;
  }

  function toggle(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="fixtures-screen">
      {groups.map((group) => (
        <section key={group.label} className="fixture-group">
          <h2 className="fixture-group__label">{group.label}</h2>
          <div className="card fixture-list">
            {group.items.map((f) => (
              <FixtureRow
                key={f.match_id}
                fixture={f}
                selected={selectedId === f.match_id}
                onToggle={() => toggle(f.match_id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
