import { usePlayerRatings } from '../../data/usePlayerRatings';
import type {
  StaticMatchDetail,
  StaticMatchLineup,
  StaticMatchLineupPlayer,
} from '../../data/staticTypes';

type RatingMap = Map<string, number>;

function RatingBadge({ rating }: { rating: number | undefined }) {
  if (rating === undefined) {
    return <span className="lineup-rating lineup-rating--empty">—</span>;
  }
  const cls =
    rating >= 8 ? 'lineup-rating--high' :
    rating >= 6.5 ? 'lineup-rating--mid' :
    'lineup-rating--low';
  return <span className={`lineup-rating ${cls}`}>{rating.toFixed(1)}</span>;
}

function PlayerRow({
  player,
  matchId,
  ratingMap,
}: {
  player: StaticMatchLineupPlayer;
  matchId: string;
  ratingMap: RatingMap;
}) {
  const rating = ratingMap.get(`${player.player_id}|${matchId}`);
  const posCls = player.position === 'GK' ? 'lineup-pos-badge lineup-pos-badge--gk' : 'lineup-pos-badge';
  return (
    <div className="lineup-player">
      <span className="lineup-player__num">{player.jersey_number}</span>
      <span className={posCls}>{player.position}</span>
      <span className="lineup-player__name">{player.player_name}</span>
      {player.minute_on !== undefined && (
        <span className="lineup-player__sub-on">{player.minute_on}'</span>
      )}
      <RatingBadge rating={rating} />
    </div>
  );
}

function TeamLineup({
  lineup,
  teamName,
  teamFlag,
  matchId,
  ratingMap,
}: {
  lineup: StaticMatchLineup;
  teamName: string;
  teamFlag: string;
  matchId: string;
  ratingMap: RatingMap;
}) {
  const starters = lineup.players.filter((p) => p.is_starter);
  const subs = lineup.players.filter((p) => !p.is_starter);

  return (
    <div className="lineup-team card">
      <div className="lineup-team__header card-head">
        <span className="card-head__title">
          <span className="lineup-team__flag">{teamFlag}</span>
          {teamName}
        </span>
        {lineup.formation && (
          <span className="lineup-team__formation">{lineup.formation}</span>
        )}
      </div>

      <div className="lineup-section">
        <div className="lineup-section__title">Starting XI</div>
        {starters.map((p) => (
          <PlayerRow key={p.player_id} player={p} matchId={matchId} ratingMap={ratingMap} />
        ))}
      </div>

      {subs.length > 0 && (
        <div className="lineup-section">
          <div className="lineup-section__title">Substitutes</div>
          {subs.map((p) => (
            <PlayerRow key={p.player_id} player={p} matchId={matchId} ratingMap={ratingMap} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LineupsTab({ detail }: { detail: StaticMatchDetail }) {
  const { playerRatings } = usePlayerRatings();

  const ratingMap = new Map<string, number>();
  for (const r of playerRatings) {
    ratingMap.set(`${r.player_id}|${r.match_id}`, r.rating);
  }

  if (!detail.lineups) {
    return (
      <div className="placeholder-screen">
        <p className="placeholder-desc">Lineup data is not yet available for this match.</p>
      </div>
    );
  }

  return (
    <div className="lineups-panel">
      <TeamLineup
        lineup={detail.lineups.home}
        teamName={detail.home_team}
        teamFlag={detail.home_flag}
        matchId={detail.match_id}
        ratingMap={ratingMap}
      />
      <TeamLineup
        lineup={detail.lineups.away}
        teamName={detail.away_team}
        teamFlag={detail.away_flag}
        matchId={detail.match_id}
        ratingMap={ratingMap}
      />
    </div>
  );
}
