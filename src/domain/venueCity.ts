// Static venue→city lookup for the 16 FIFA World Cup 2026 host stadiums.
// No network dependency — derived purely from the venue string already on Match.

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Reduce a venue string to a stable comparison key:
 *   1. Decompose Unicode and strip combining marks (handles é, ü, etc.)
 *   2. Lowercase
 *   3. Replace every run of non-alphanumeric characters with a single space
 *   4. Trim
 *
 * "Levi's Stadium" and "Levis Stadium" both become "levi s stadium".
 * "AT&T Stadium" becomes "at t stadium"; "ATT Stadium" becomes "att stadium" —
 * both are registered as separate raw entries below.
 */
export function normalizeVenue(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')          // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')     // non-alphanumeric → single space
    .trim();
}

// ---------------------------------------------------------------------------
// Static data — all 16 host stadiums
// ---------------------------------------------------------------------------
// Each tuple is [raw venue name as commonly used, host city].
// Multiple entries for the same stadium cover known spelling variants that
// football-data.org or other upstream sources may return.

const _RAW: ReadonlyArray<[string, string]> = [
  // ── United States (11) ──────────────────────────────────────────────────
  ['MetLife Stadium',                    'New York / New Jersey'],

  ['AT&T Stadium',                       'Dallas'],   // "at t stadium" after normalize
  ['ATT Stadium',                        'Dallas'],   // "att stadium" — no-ampersand variant

  ['SoFi Stadium',                       'Los Angeles'],

  ["Levi's Stadium",                     'San Francisco Bay Area'],  // apostrophe → "levi s"
  ['Levis Stadium',                      'San Francisco Bay Area'],  // no apostrophe

  ['Gillette Stadium',                   'Boston'],

  ['Lincoln Financial Field',            'Philadelphia'],

  ['NRG Stadium',                        'Houston'],

  ['Arrowhead Stadium',                  'Kansas City'],
  ['GEHA Field at Arrowhead Stadium',    'Kansas City'],  // current naming-rights name

  ['Mercedes-Benz Stadium',              'Atlanta'],  // hyphen stripped → "mercedes benz"
  ['Mercedes Benz Stadium',              'Atlanta'],  // explicit no-hyphen alias

  ['Hard Rock Stadium',                  'Miami'],

  ['Lumen Field',                        'Seattle'],

  // ── Canada (2) ──────────────────────────────────────────────────────────
  ['BC Place',                           'Vancouver'],
  ['BC Place Stadium',                   'Vancouver'],

  ['BMO Field',                          'Toronto'],

  // ── Mexico (3) ──────────────────────────────────────────────────────────
  ['Estadio Azteca',                     'Mexico City'],
  ['Azteca Stadium',                     'Mexico City'],  // English usage

  ['Estadio BBVA',                       'Monterrey'],
  ['Estadio BBVA Bancomer',              'Monterrey'],
  ['BBVA Stadium',                       'Monterrey'],

  ['Estadio Akron',                      'Guadalajara'],
  ['Estadio Omnilife',                   'Guadalajara'],  // former name still in circulation
  ['Akron Stadium',                      'Guadalajara'],
];

/** Immutable map from normalized venue key → city name, built once at module load. */
const VENUE_CITY_MAP: ReadonlyMap<string, string> = new Map(
  _RAW.map(([venue, city]) => [normalizeVenue(venue), city]),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a raw venue string to its host city.
 * The venue is normalized before lookup so case and minor punctuation
 * differences are absorbed.
 *
 * Returns `undefined` — never throws — when:
 *  - venue is null, undefined, or an empty string
 *  - the venue doesn't match any of the 16 known host stadiums
 */
export function resolveCity(venue: string | null | undefined): string | undefined {
  if (!venue) return undefined;
  return VENUE_CITY_MAP.get(normalizeVenue(venue));
}
