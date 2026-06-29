// Typed contracts for every JSON file under public/data/.
// Interfaces here mirror the shapes produced by scripts/export_json.py.

// ---- manifest.json ----

export interface ManifestFileEntry {
  rows: number;
  sha256: string;
}

export interface ManifestMatchesEntry {
  count: number;
  sha256_by_id: Record<string, string>;
}

export interface ManifestData {
  generated_at: string;        // ISO-8601 — when the pipeline last ran
  schema_version: string;
  competition_id: string;
  content_hash: string;
  files: {
    'competitions.json'?: ManifestFileEntry;
    'fixtures.json': ManifestFileEntry;
    'standings.json': ManifestFileEntry;
    'scorers.json': ManifestFileEntry;
    'player_stats.json': ManifestFileEntry;
    'player_ratings.json': ManifestFileEntry;
    'matches/': ManifestMatchesEntry;
  };
}

// ---- fixtures.json / matches/<id>.json ----
// SQLite has no boolean type; `played` is 0 or 1.

export interface StaticFixture {
  match_id: string;
  kickoff: string;
  stage: string;
  group_id: string | null;
  home_team_id: string;
  home_team: string;
  home_code: string;
  home_flag: string;
  home_goals: number | null;
  away_team_id: string;
  away_team: string;
  away_code: string;
  away_flag: string;
  away_goals: number | null;
  played: number;
  venue?: string | null;
}

export interface StaticTeamMatchStats {
  possession: number | null;
  shots: number | null;
  shots_on_target: number | null;
  passes: number | null;
  pass_completion_pct: number | null;
  corners: number | null;
  free_kicks: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
}

export interface StaticMatchStats {
  home: StaticTeamMatchStats;
  away: StaticTeamMatchStats;
}

export type StaticMatchDetail = StaticFixture & {
  lineups?: {
    home: StaticMatchLineup;
    away: StaticMatchLineup;
  };
  stats?: StaticMatchStats;
};

// ---- standings.json ----

export interface StaticStanding {
  group_id: string;
  position: number | null;
  team: string;
  code: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
}

// ---- scorers.json ----

export interface StaticScorer {
  rank: number;
  player_name: string;
  team: string;
  team_code: string;
  team_flag: string;
  goals: number;
  assists: number;
  penalties: number;
}

// ---- player_stats.json ----

export interface StaticPlayerStat {
  player_id: string;
  display_name: string;
  source: string | null;
  team: string;
  team_code: string;
  matches_played: number;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  passes: number;
  pass_accuracy: number | null;
}

// ---- player_ratings.json ----

export interface StaticPlayerRating {
  player_id: string;
  team: string;
  team_code: string;
  match_id: string;
  source: string;
  rating: number;
}

// ---- matches/<id>.json (lineup extension) ----

export interface StaticMatchLineupPlayer {
  player_id: string;
  player_name: string;
  jersey_number: number;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  is_starter: boolean;
  minute_on?: number;
  minute_off?: number;
}

export interface StaticMatchLineup {
  team_id: string;
  formation?: string;
  players: StaticMatchLineupPlayer[];
}
