// Core domain types for the tournament. No React, no network — pure data shapes.

/** The 12 group letters in the 2026 World Cup. */
export type GroupId =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';

export const GROUP_IDS: GroupId[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
];

/** A position within a group (1 = winner, 4 = last). */
export type GroupPosition = 1 | 2 | 3 | 4;

export interface Team {
  id: string;        // stable slug, e.g. "argentina"
  name: string;      // display name, e.g. "Argentina"
  code: string;      // 3-letter code, e.g. "ARG"
  groupId: GroupId;  // the group this team belongs to
  flag?: string;     // optional emoji or asset URL
}

/** A single fixture. Goals are undefined until the match is played. */
export interface Match {
  id: string;
  stage: Stage;
  groupId?: GroupId;     // present for group-stage matches only
  homeId: string;        // Team.id
  awayId: string;        // Team.id
  homeGoals?: number;
  awayGoals?: number;
  kickoff: string;       // ISO date string
  played: boolean;
}

export type Stage =
  | 'group'
  | 'round32'
  | 'round16'
  | 'quarter'
  | 'semi'
  | 'thirdPlacePlayoff'
  | 'final';

/** A computed standings row for one team within its group. */
export interface Standing {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: GroupPosition; // resolved rank after tiebreakers
}

/** Which placements are still mathematically reachable for a team. */
export interface PlacementPossibility {
  teamId: string;
  canFinish1st: boolean;
  canFinish2nd: boolean;
  canFinish3rd: boolean;
  canFinish4th: boolean;
  // True once the group is fully played and the position is fixed.
  locked: boolean;
}

/** A slot in the knockout bracket. */
export interface BracketSlot {
  matchId: number;       // 73–104
  stage: Stage;
  homeId?: string;       // resolved team id; undefined = TBD
  awayId?: string;
  winnerId?: string;     // user pick or real result
  locked: boolean;       // true if real result locks this slot
}

/** The full user-facing tournament state held in the store. */
export interface TournamentState {
  teams: Record<string, Team>;
  matches: Match[];
  // User-chosen ordering of each group (team ids, index 0 = 1st place).
  groupOrder: Record<GroupId, string[]>;
  // User-chosen ranking of the 12 third-place teams (best first).
  thirdPlaceRanking: string[];
  // User's winner picks keyed by bracket matchId (73–104).
  // The full bracket is derived via domain/knockout.computeBracket.
  bracketPicks: Record<number, string>;
}
