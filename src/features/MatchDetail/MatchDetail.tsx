import { useTournamentStore } from '../../store/tournamentStore';

export function MatchDetail() {
  const selectedMatchId = useTournamentStore((s) => s.selectedMatchId);
  const closeMatchDetail = useTournamentStore((s) => s.closeMatchDetail);

  return (
    <div className="placeholder-screen">
      <button className="match-detail-back" onClick={closeMatchDetail}>
        ← Back
      </button>
      <h2 className="placeholder-title">Match detail</h2>
      <p className="placeholder-desc">Match {selectedMatchId}</p>
    </div>
  );
}
