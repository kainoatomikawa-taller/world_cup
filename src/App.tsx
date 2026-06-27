import { useState, useEffect } from 'react';
import { Fixtures } from './features/Fixtures/Fixtures';
import { GroupStage } from './features/GroupStage/GroupStage';
import { ThirdPlace } from './features/ThirdPlace/ThirdPlace';
import { Bracket } from './features/Bracket/Bracket';
import { StageNav, type StageKey } from './features/shared/StageNav';
import { useTournamentStore } from './store/tournamentStore';
import { TEAMS } from './data/schedule2026';
import { fetchLiveMatches } from './data/api';
import './App.css';

type FetchStatus = 'loading' | 'live' | 'offline';

export default function App() {
  const [stage, setStage] = useState<StageKey>('fixtures');
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('loading');

  const initialize = useTournamentStore((s) => s.initialize);
  const setMatches = useTournamentStore((s) => s.setMatches);

  useEffect(() => {
    // Populate teams immediately so the UI renders without waiting for the network.
    initialize(TEAMS, []);

    fetchLiveMatches()
      .then((matches) => {
        setMatches(matches);
        setFetchStatus('live');
      })
      .catch(() => {
        // Under plain `npm run dev` the /api/* proxy doesn't run — fall back
        // gracefully to empty matches (manual-drag mode, same as before).
        setFetchStatus('offline');
      });
  }, [initialize, setMatches]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="app-title">World Cup 2026 Possibilities</h1>
        <p className="app-subtitle">
          Build your own road to the final — set the groups, rank the third-place
          teams, and play out the knockout bracket.
        </p>
        <p className={`live-status live-status--${fetchStatus}`}>
          {fetchStatus === 'loading' && 'Fetching live scores…'}
          {fetchStatus === 'live' && '● Live scores loaded'}
          {fetchStatus === 'offline' && 'Scores unavailable — drag to set standings manually'}
        </p>
      </header>
      <StageNav current={stage} onChange={setStage} />
      {stage === 'fixtures' && <Fixtures />}
      {stage === 'groups' && <GroupStage />}
      {stage === 'thirdPlace' && <ThirdPlace />}
      {stage === 'bracket' && <Bracket />}
    </main>
  );
}
