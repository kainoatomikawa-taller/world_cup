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
}

export type StaticMatchDetail = StaticFixture;

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
