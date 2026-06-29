import { useState, useEffect } from 'react';
import { Fixtures } from './features/Fixtures/Fixtures';
import { GroupStage } from './features/GroupStage/GroupStage';
import { ThirdPlace } from './features/ThirdPlace/ThirdPlace';
import { Bracket } from './features/Bracket/Bracket';
import { InsightsDashboard } from './features/Insights/InsightsDashboard';
import { StageNav, type StageKey } from './features/shared/StageNav';
import { MatchDetail } from './features/MatchDetail/MatchDetail';
import { StatsDashboard } from './features/Stats/StatsDashboard';
import { useTournamentStore } from './store/tournamentStore';
import { TEAMS } from './data/schedule2026';
import { fetchStaticMatches } from './data/api';
import { useDataContext } from './data/DataContext';
import './App.css';

type FetchStatus = 'loading' | 'ready' | 'offline';

function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

export default function App() {
  const { contentHash, lastUpdated, manifestReady } = useDataContext();
  const [topTab, setTopTab] = useState<StageKey>('possibilities');
  type PossibilitiesView = 'groups' | 'thirdPlace' | 'bracket';
  const [stage, setStage] = useState<PossibilitiesView>('groups');
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('loading');

  const initialize = useTournamentStore((s) => s.initialize);
  const setMatches = useTournamentStore((s) => s.setMatches);
  const view = useTournamentStore((s) => s.view);

  useEffect(() => {
    initialize(TEAMS, []);
  }, [initialize]);

  useEffect(() => {
    if (!manifestReady) return;
    fetchStaticMatches(contentHash)
      .then((matches) => {
        setMatches(matches);
        setFetchStatus('ready');
      })
      .catch(() => {
        setFetchStatus('offline');
      });
  }, [manifestReady, contentHash, setMatches]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-title">World Cup 2026</h1>
        <p className="app-subtitle">
          Your complete guide to the 48-team tournament — scenarios, fixtures,
          and insights in one place.
        </p>
      </header>

      {view === 'matchDetail' ? (
        <MatchDetail />
      ) : (
        <>
      <StageNav current={topTab} onChange={setTopTab} />

      {topTab === 'possibilities' && (
        <>
          <p className={`live-status live-status--${fetchStatus}`}>
            {fetchStatus === 'loading' && 'Loading data…'}
            {fetchStatus === 'ready' &&
              (lastUpdated
                ? `Updated ${formatLastUpdated(lastUpdated)}`
                : 'Data loaded')}
            {fetchStatus === 'offline' &&
              'Data unavailable — drag to set standings manually'}
          </p>
          <nav className="stage-nav">
            {(
              [
                { key: 'groups', label: 'Group stage' },
                { key: 'thirdPlace', label: 'Third place' },
                { key: 'bracket', label: 'Knockout' },
              ] as { key: PossibilitiesView; label: string }[]
            ).map((s) => (
              <button
                key={s.key}
                className="stage-tab"
                onClick={() => setStage(s.key)}
                aria-current={stage === s.key}
              >
                {s.label}
              </button>
            ))}
          </nav>
          {stage === 'groups' && <GroupStage />}
          {stage === 'thirdPlace' && <ThirdPlace />}
          {stage === 'bracket' && <Bracket />}
        </>
      )}

      {topTab === 'fixtures' && <Fixtures />}

      {topTab === 'insights' && <InsightsDashboard />}

      {topTab === 'stats' && <StatsDashboard />}
        </>
      )}
    </main>
  );
}
