// Knockout bracket: R32 → R16 → QF → SF → Final.
// Column-per-round layout. Click a team to pick the winner; click again to undo.
// The bracket re-seeds automatically when group orders or third-place rankings change.
import { getChampion, getRunnerUp, getThirdPlace } from '../../domain/knockout';
import { useBracketData } from './useBracketData';
import { BracketMatch } from './BracketMatch';
import { useTournamentStore } from '../../store/tournamentStore';

// Height of one R32 slot. Later rounds have proportionally taller slots so each
// card sits vertically centred over the pair of feeders below it.
const SLOT_H = 120;
const TOTAL_H = 16 * SLOT_H; // 1920px — all columns are this height

// Match display order derived from a left-to-right DFS of the bracket tree.
// Adjacent entries in each round feed the same next-round match, which produces
// correct visual alignment without explicit connector lines.
const ROUNDS: { label: string; matchIds: number[] }[] = [
  { label: 'Round of 32',   matchIds: [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87] },
  { label: 'Round of 16',   matchIds: [89, 90, 93, 94, 91, 92, 95, 96] },
  { label: 'Quarter-finals', matchIds: [97, 98, 99, 100] },
  { label: 'Semi-finals',   matchIds: [101, 102] },
  { label: 'Final',         matchIds: [104] },
];

export function Bracket() {
  const { bracket, teams, setPick, clearPick, hasUserPicks } = useBracketData();
  const clearAllPicks = useTournamentStore((s) => s.clearAllPicks);
  const champion = getChampion(bracket);
  const champTeam = champion ? teams[champion] : undefined;
  const runnerUp = getRunnerUp(bracket);
  const runnerUpTeam = runnerUp ? teams[runnerUp] : undefined;
  const thirdPlace = getThirdPlace(bracket);
  const thirdTeam = thirdPlace ? teams[thirdPlace] : undefined;
  const thirdSlot = bracket[103];

  function handlePick(matchId: number, teamId: string) {
    // Toggle: clicking the current winner removes the pick.
    if (bracket[matchId]?.winnerId === teamId) {
      clearPick(matchId);
    } else {
      setPick(matchId, teamId);
    }
  }

  return (
    <section>
      <div className="bracket-header">
        <div>
          <h2 style={{ marginBottom: 4 }}>Knockout Bracket</h2>
          <p className="screen-intro">
            Click a team to pick the winner. Click the selected team again to undo.
            The bracket re-seeds automatically when you adjust group or third-place rankings.
          </p>
        </div>
        {hasUserPicks && (
          <button className="bracket-reset-btn" onClick={clearAllPicks}>
            Reset picks
          </button>
        )}
      </div>

      {/* Champion banner */}
      {champTeam && (
        <div className="champion-banner">
          <span className="champion-banner__trophy">🏆</span>
          <span className="champion-banner__flag">{champTeam.flag ?? '🏳️'}</span>
          <span className="champion-banner__name">{champTeam.name}</span>
          <span className="champion-banner__label">2026 World Cup Champion</span>
        </div>
      )}

      {/* Runner-up banner */}
      {runnerUpTeam && (
        <div className="champion-banner champion-banner--silver">
          <span className="champion-banner__trophy">🥈</span>
          <span className="champion-banner__flag">{runnerUpTeam.flag ?? '🏳️'}</span>
          <span className="champion-banner__name">{runnerUpTeam.name}</span>
          <span className="champion-banner__label">Runner-Up</span>
        </div>
      )}

      {/* Third-place banner */}
      {thirdTeam && (
        <div className="champion-banner champion-banner--bronze">
          <span className="champion-banner__trophy">🥉</span>
          <span className="champion-banner__flag">{thirdTeam.flag ?? '🏳️'}</span>
          <span className="champion-banner__name">{thirdTeam.name}</span>
          <span className="champion-banner__label">Third Place</span>
        </div>
      )}

      {/* Bracket grid — scrollable in both axes */}
      <div className="bracket-scroll">
        <div className="bracket-grid">
          {ROUNDS.map((round) => {
            const slotH = TOTAL_H / round.matchIds.length;

            return (
              <div key={round.label} className="round-col">
                <div className="round-head">{round.label}</div>

                {/* Match slots — fixed total height so cards align across rounds */}
                <div style={{ height: TOTAL_H }}>
                  {round.matchIds.map((matchId) => {
                    const slot = bracket[matchId];
                    return (
                      <div key={matchId} className="round-slot" style={{ height: slotH }}>
                        {slot && (
                          <BracketMatch
                            slot={slot}
                            teams={teams}
                            onPick={(teamId) => handlePick(matchId, teamId)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Third-place playoff sits just beneath the (vertically
                    centred) Final card — pulled up from the bottom of the
                    full-height column via a negative margin. */}
                {round.label === 'Final' && thirdSlot && (
                  <div
                    className="third-place-playoff"
                    style={{ marginTop: -(TOTAL_H / 2) + 80 }}
                  >
                    <div className="round-head">Third-Place Playoff</div>
                    <BracketMatch
                      slot={thirdSlot}
                      teams={teams}
                      onPick={(teamId) => handlePick(103, teamId)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
