import { useState } from 'react';
import { useTournamentStore } from '../../store/tournamentStore';
import { useMatchDetail } from '../../data/useMatchDetail';
import { LineupsTab } from './LineupsTab';

type MatchTab = 'lineups' | 'gameStats' | 'insights';

const TABS: { key: MatchTab; label: string }[] = [
  { key: 'lineups', label: 'Lineups' },
  { key: 'gameStats', label: 'Game Stats' },
  { key: 'insights', label: 'Insights' },
];

const STAGE_LABEL: Record<string, string> = {
  group: 'Group Stage',
  round32: 'Round of 32',
  round16: 'Round of 16',
  quarter: 'Quarter-final',
  semi: 'Semi-final',
  thirdPlacePlayoff: 'Third-Place Play-off',
  final: 'Final',
};

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

export function MatchDetail() {
  const selectedMatchId = useTournamentStore((s) => s.selectedMatchId);
  const closeMatchDetail = useTournamentStore((s) => s.closeMatchDetail);
  const [activeTab, setActiveTab] = useState<MatchTab>('lineups');
  const { detail, loading, error } = useMatchDetail(selectedMatchId);

  return (
    <div className="match-detail-page">
      <button className="match-detail-back-btn" onClick={closeMatchDetail}>
        ← Back
      </button>

      {loading && <p className="screen-intro">Loading match…</p>}
      {error && (
        <p className="screen-intro">
          Could not load match ({error}).
        </p>
      )}

      {detail && (
        <>
          <div className="match-detail-header card">
            <div className="mdh-stage">
              {STAGE_LABEL[detail.stage] ?? detail.stage}
              {detail.group_id ? ` · Group ${detail.group_id}` : ''}
            </div>

            <div className="mdh-teams">
              <span className="mdh-team mdh-team--home">
                <span className="mdh-flag">{detail.home_flag}</span>
                <span className="mdh-name">{detail.home_team || 'TBD'}</span>
              </span>

              <span className="mdh-score">
                {detail.played === 1
                  ? `${detail.home_goals ?? 0} – ${detail.away_goals ?? 0}`
                  : 'vs'}
              </span>

              <span className="mdh-team mdh-team--away">
                <span className="mdh-name">{detail.away_team || 'TBD'}</span>
                <span className="mdh-flag">{detail.away_flag}</span>
              </span>
            </div>

            <div className="mdh-date">{formatKickoff(detail.kickoff)}</div>
          </div>

          <nav className="stage-nav match-detail-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className="stage-tab"
                onClick={() => setActiveTab(t.key)}
                aria-current={activeTab === t.key}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="match-detail-tab-panel">
            {activeTab === 'lineups' && (
              <LineupsTab detail={detail} />
            )}
            {activeTab === 'gameStats' && (
              <div className="placeholder-screen">
                <p className="placeholder-desc">
                  Match statistics are not yet available for this match.
                </p>
              </div>
            )}
            {activeTab === 'insights' && (
              <div className="placeholder-screen">
                <p className="placeholder-desc">
                  Insights are not yet available for this match.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
