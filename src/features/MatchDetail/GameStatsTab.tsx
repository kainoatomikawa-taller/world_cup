import type { StaticMatchDetail, StaticTeamMatchStats } from '../../data/staticTypes';

type StatKey = keyof StaticTeamMatchStats;

interface StatDef {
  label: string;
  key: StatKey;
  format?: (v: number) => string;
  /** Optional extra CSS modifier on both value spans */
  valMod?: string;
}

const pct = (v: number) => `${v}%`;

const STAT_DEFS: StatDef[] = [
  { label: 'Possession',       key: 'possession',         format: pct },
  { label: 'Shots',            key: 'shots' },
  { label: 'Shots on Target',  key: 'shots_on_target' },
  { label: 'Passes',           key: 'passes' },
  { label: 'Pass Completion',  key: 'pass_completion_pct', format: pct },
  { label: 'Corners',          key: 'corners' },
  { label: 'Free Kicks',       key: 'free_kicks' },
  { label: 'Yellow Cards',     key: 'yellow_cards',        valMod: 'gst-val--yellow' },
  { label: 'Red Cards',        key: 'red_cards',           valMod: 'gst-val--red' },
];

function getBarWidths(
  home: number | null,
  away: number | null,
): [number, number] {
  if (home === null || away === null) return [50, 50];
  const total = home + away;
  if (total === 0) return [50, 50];
  const hw = (home / total) * 100;
  return [hw, 100 - hw];
}

function fmtVal(v: number | null, format?: (n: number) => string): string {
  if (v === null) return '—';
  return format ? format(v) : String(v);
}

function StatRow({
  label,
  homeVal,
  awayVal,
  format,
  valMod,
}: {
  label: string;
  homeVal: number | null;
  awayVal: number | null;
  format?: (v: number) => string;
  valMod?: string;
}) {
  const missing = homeVal === null || awayVal === null;
  const [homeW, awayW] = getBarWidths(homeVal, awayVal);
  const valCls = valMod ? ` ${valMod}` : '';

  return (
    <div className="gst-row">
      <div className="gst-row-header">
        <span className={`gst-val gst-val--home${valCls}`}>
          {fmtVal(homeVal, format)}
        </span>
        <span className="gst-stat-label">{label}</span>
        <span className={`gst-val gst-val--away${valCls}`}>
          {fmtVal(awayVal, format)}
        </span>
      </div>
      <div className={`gst-bar-wrap${missing ? ' gst-bar-wrap--missing' : ''}`}>
        <div className="gst-bar gst-bar--home" style={{ width: `${homeW}%` }} />
        <div className="gst-bar gst-bar--away" style={{ width: `${awayW}%` }} />
      </div>
    </div>
  );
}

export function GameStatsTab({ detail }: { detail: StaticMatchDetail }) {
  if (!detail.stats) {
    return (
      <div className="placeholder-screen">
        <p className="placeholder-desc">
          Match statistics are not yet available for this match.
        </p>
      </div>
    );
  }

  const { home, away } = detail.stats;

  return (
    <div className="gst-panel card">
      <div className="gst-teams-header">
        <span className="gst-team-name gst-team-name--home">
          <span className="gst-team-flag">{detail.home_flag}</span>
          {detail.home_team}
        </span>
        <span className="gst-teams-divider">vs</span>
        <span className="gst-team-name gst-team-name--away">
          {detail.away_team}
          <span className="gst-team-flag">{detail.away_flag}</span>
        </span>
      </div>

      <div className="gst-list">
        {STAT_DEFS.map(({ label, key, format, valMod }) => (
          <StatRow
            key={key}
            label={label}
            homeVal={home[key]}
            awayVal={away[key]}
            format={format}
            valMod={valMod}
          />
        ))}
      </div>
    </div>
  );
}
