import { useState, useEffect } from 'react';
import { Fixtures } from './features/Fixtures/Fixtures';
import { GroupStage } from './features/GroupStage/GroupStage';
import { ThirdPlace } from './features/ThirdPlace/ThirdPlace';
import { Bracket } from './features/Bracket/Bracket';
import { InsightsDashboard } from './features/Insights/InsightsDashboard';
import { AppNav, type AppTab } from './features/shared/AppNav';
import { StageNav, type StageKey } from './features/shared/StageNav';
import { PlaceholderTab } from './features/shared/PlaceholderTab';
import { PlayerStats } from './features/Ratings/PlayerStats';
import { useTournamentStore } from './store/tournamentStore';
import { TEAMS } from './data/schedule2026';
import { fetchManifest, fetchStaticMatches } from './data/api';
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
  const [topTab, setTopTab] = useState<AppTab>('possibilities');
  const [stage, setStage] = useState<StageKey>('groups');
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const initialize = useTournamentStore((s) => s.initialize);
  const setMatches = useTournamentStore((s) => s.setMatches);

  useEffect(() => {
    initialize(TEAMS, []);

    fetchManifest()
      .then((manifest) => {
        setLastUpdated(manifest.generated_at);
        return fetchStaticMatches();
      })
      .then((matches) => {
        setMatches(matches);
        setFetchStatus('ready');
      })
      .catch(() => {
        setFetchStatus('offline');
      });
  }, [initialize, setMatches]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-title">World Cup 2026</h1>
        <p className="app-subtitle">
          Your complete guide to the 48-team tournament — scenarios, fixtures,
          and insights in one place.
        </p>
      </header>

      <AppNav current={topTab} onChange={setTopTab} />

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
          <StageNav current={stage} onChange={setStage} />
          {stage === 'groups' && <GroupStage />}
          {stage === 'thirdPlace' && <ThirdPlace />}
          {stage === 'bracket' && <Bracket />}
        </>
      )}

      {topTab === 'fixtures' && <Fixtures />}

      {topTab === 'insights' && <InsightsDashboard />}

      {topTab === 'lineups' && (
        <PlaceholderTab
          title="Lineups"
          description="Starting XIs, formations, and squad depth for every competing nation."
        />
      )}

      {topTab === 'ratings' && <PlayerStats />}
    </main>
  );
}
