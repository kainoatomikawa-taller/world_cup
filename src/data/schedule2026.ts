// Static tournament facts: the 48 teams and their groups for the 2026 FIFA World
// Cup, per the final draw (Washington, D.C., 5 Dec 2025). Teams are listed in
// pot/seed order within each group.
//
// FIXTURES is intentionally left empty for now — match results come from the
// live data feed (see data/api.ts). Tests and the rules engine accept any
// Match[] passed in, so standings logic does not depend on this list yet.
import type { Match, Team } from '../domain/types';

export const TEAMS: Team[] = [
  // Group A
  { id: 'mexico',         name: 'Mexico',       code: 'MEX', groupId: 'A', flag: '🇲🇽' },
  { id: 'south-africa',   name: 'South Africa', code: 'RSA', groupId: 'A', flag: '🇿🇦' },
  { id: 'south-korea',    name: 'South Korea',  code: 'KOR', groupId: 'A', flag: '🇰🇷' },
  { id: 'czech-republic', name: 'Czech Republic', code: 'CZE', groupId: 'A', flag: '🇨🇿' },

  // Group B
  { id: 'canada',                   name: 'Canada',                   code: 'CAN', groupId: 'B', flag: '🇨🇦' },
  { id: 'bosnia-and-herzegovina',   name: 'Bosnia and Herzegovina',   code: 'BIH', groupId: 'B', flag: '🇧🇦' },
  { id: 'qatar',                    name: 'Qatar',                    code: 'QAT', groupId: 'B', flag: '🇶🇦' },
  { id: 'switzerland',              name: 'Switzerland',              code: 'SUI', groupId: 'B', flag: '🇨🇭' },

  // Group C
  { id: 'brazil',   name: 'Brazil',   code: 'BRA', groupId: 'C', flag: '🇧🇷' },
  { id: 'morocco',  name: 'Morocco',  code: 'MAR', groupId: 'C', flag: '🇲🇦' },
  { id: 'haiti',    name: 'Haiti',    code: 'HAI', groupId: 'C', flag: '🇭🇹' },
  { id: 'scotland', name: 'Scotland', code: 'SCO', groupId: 'C', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },

  // Group D
  { id: 'united-states', name: 'United States', code: 'USA', groupId: 'D', flag: '🇺🇸' },
  { id: 'paraguay',      name: 'Paraguay',      code: 'PAR', groupId: 'D', flag: '🇵🇾' },
  { id: 'australia',     name: 'Australia',     code: 'AUS', groupId: 'D', flag: '🇦🇺' },
  { id: 'turkey',        name: 'Turkey',        code: 'TUR', groupId: 'D', flag: '🇹🇷' },

  // Group E
  { id: 'germany',     name: 'Germany',     code: 'GER', groupId: 'E', flag: '🇩🇪' },
  { id: 'curacao',     name: 'Curaçao',     code: 'CUW', groupId: 'E', flag: '🇨🇼' },
  { id: 'ivory-coast', name: 'Ivory Coast', code: 'CIV', groupId: 'E', flag: '🇨🇮' },
  { id: 'ecuador',     name: 'Ecuador',     code: 'ECU', groupId: 'E', flag: '🇪🇨' },

  // Group F
  { id: 'netherlands', name: 'Netherlands', code: 'NED', groupId: 'F', flag: '🇳🇱' },
  { id: 'japan',       name: 'Japan',       code: 'JPN', groupId: 'F', flag: '🇯🇵' },
  { id: 'sweden',      name: 'Sweden',      code: 'SWE', groupId: 'F', flag: '🇸🇪' },
  { id: 'tunisia',     name: 'Tunisia',     code: 'TUN', groupId: 'F', flag: '🇹🇳' },

  // Group G
  { id: 'belgium',     name: 'Belgium',     code: 'BEL', groupId: 'G', flag: '🇧🇪' },
  { id: 'egypt',       name: 'Egypt',       code: 'EGY', groupId: 'G', flag: '🇪🇬' },
  { id: 'iran',        name: 'Iran',        code: 'IRN', groupId: 'G', flag: '🇮🇷' },
  { id: 'new-zealand', name: 'New Zealand', code: 'NZL', groupId: 'G', flag: '🇳🇿' },

  // Group H
  { id: 'spain',        name: 'Spain',        code: 'ESP', groupId: 'H', flag: '🇪🇸' },
  { id: 'cape-verde',   name: 'Cape Verde',   code: 'CPV', groupId: 'H', flag: '🇨🇻' },
  { id: 'saudi-arabia', name: 'Saudi Arabia', code: 'KSA', groupId: 'H', flag: '🇸🇦' },
  { id: 'uruguay',      name: 'Uruguay',      code: 'URU', groupId: 'H', flag: '🇺🇾' },

  // Group I
  { id: 'france',  name: 'France',  code: 'FRA', groupId: 'I', flag: '🇫🇷' },
  { id: 'senegal', name: 'Senegal', code: 'SEN', groupId: 'I', flag: '🇸🇳' },
  { id: 'iraq',    name: 'Iraq',    code: 'IRQ', groupId: 'I', flag: '🇮🇶' },
  { id: 'norway',  name: 'Norway',  code: 'NOR', groupId: 'I', flag: '🇳🇴' },

  // Group J
  { id: 'argentina', name: 'Argentina', code: 'ARG', groupId: 'J', flag: '🇦🇷' },
  { id: 'algeria',   name: 'Algeria',   code: 'ALG', groupId: 'J', flag: '🇩🇿' },
  { id: 'austria',   name: 'Austria',   code: 'AUT', groupId: 'J', flag: '🇦🇹' },
  { id: 'jordan',    name: 'Jordan',    code: 'JOR', groupId: 'J', flag: '🇯🇴' },

  // Group K
  { id: 'portugal',   name: 'Portugal',   code: 'POR', groupId: 'K', flag: '🇵🇹' },
  { id: 'dr-congo',   name: 'DR Congo',   code: 'COD', groupId: 'K', flag: '🇨🇩' },
  { id: 'uzbekistan', name: 'Uzbekistan', code: 'UZB', groupId: 'K', flag: '🇺🇿' },
  { id: 'colombia',   name: 'Colombia',   code: 'COL', groupId: 'K', flag: '🇨🇴' },

  // Group L
  { id: 'england', name: 'England', code: 'ENG', groupId: 'L', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'croatia', name: 'Croatia', code: 'CRO', groupId: 'L', flag: '🇭🇷' },
  { id: 'ghana',   name: 'Ghana',   code: 'GHA', groupId: 'L', flag: '🇬🇭' },
  { id: 'panama',  name: 'Panama',  code: 'PAN', groupId: 'L', flag: '🇵🇦' },
];

// TODO: populate from the live feed / official schedule (72 group matches).
export const FIXTURES: Match[] = [];

export const TEAMS_BY_ID: Record<string, Team> = Object.fromEntries(
  TEAMS.map((t) => [t.id, t]),
);
