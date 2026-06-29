export type InsightCategory = 'tactical' | 'stats' | 'player' | 'news';

export interface MatchInsight {
  id: string;
  title: string;
  source: string;
  url: string;
  description?: string;
  category: InsightCategory;
}

const INSIGHTS: Record<string, MatchInsight[]> = {
  '537327': [
    {
      id: '537327-1',
      title: "Mexico's high press stifles South Africa in World Cup opener",
      source: 'The Athletic',
      url: '#',
      description:
        "Analysis of how El Tri's aggressive 4-3-3 press forced 14 turnovers in the South African half across the first 60 minutes.",
      category: 'tactical',
    },
    {
      id: '537327-2',
      title: 'Match stats: Mexico 2–0 South Africa — shot map and key numbers',
      source: 'Opta',
      url: '#',
      description:
        "Mexico registered 7 shots on target (xG: 2.34) versus South Africa's 1 (xG: 0.18) in the Group A opener at SoFi Stadium.",
      category: 'stats',
    },
    {
      id: '537327-3',
      title: "Hirving Lozano opens the scoring with a perfectly-timed diagonal run",
      source: 'FIFA.com',
      url: '#',
      description:
        'The veteran winger timed his run to perfection, latching onto a through ball in the 23rd minute to break the deadlock.',
      category: 'player',
    },
  ],
  '537339': [
    {
      id: '537339-1',
      title: "Brazil vs Morocco: how Dorival's 4-2-3-1 neutralised the counter",
      source: 'The Athletic',
      url: '#',
      description:
        "A tactical deep-dive into Brazil's double pivot that kept Morocco's pacy forwards in check throughout the 90 minutes.",
      category: 'tactical',
    },
    {
      id: '537339-2',
      title: 'Vinicius Jr. Player Rating: 8.4 — the decisive difference-maker',
      source: 'Sofascore',
      url: '#',
      category: 'player',
    },
  ],
  '537345': [
    {
      id: '537345-1',
      title: 'USMNT heat map: dominant right flank carries opener vs. Paraguay',
      source: 'Opta',
      url: '#',
      description:
        'The United States created 68% of their attacking play through the right channel, with Pulisic and McKennie combining for 6 chances created.',
      category: 'stats',
    },
    {
      id: '537345-2',
      title: 'Christian Pulisic masterclass in front of a sold-out MetLife crowd',
      source: 'ESPN',
      url: '#',
      description:
        'The US captain scored, assisted, and drew two key free kicks in the host nation\'s opening group stage win.',
      category: 'player',
    },
    {
      id: '537345-3',
      title: 'All roads lead to the Round of 32 for Berhalter\'s evolving side',
      source: 'The Athletic',
      url: '#',
      description:
        'With three points already banked, the USMNT faces Australia with qualification well within reach.',
      category: 'news',
    },
  ],
  '537415': [
    {
      id: '537415-1',
      title: "Germany vs Paraguay preview — Nagelsmann's high line meets Aranda's counter",
      source: 'The Athletic',
      url: '#',
      description:
        "Germany's aggressive defensive line could be vulnerable to the pace of Paraguay's forwards in this Round of 32 clash.",
      category: 'tactical',
    },
    {
      id: '537415-2',
      title: "Florian Wirtz: the playmaker carrying Germany's knockout stage hopes",
      source: 'ESPN',
      url: '#',
      category: 'player',
    },
  ],
  '537416': [
    {
      id: '537416-1',
      title: "France vs Sweden: can Mbappé's pace unlock Sweden's back five?",
      source: 'The Athletic',
      url: '#',
      description:
        "Sweden's defensive block has conceded just once in the group stage. France will need creativity to break them down.",
      category: 'tactical',
    },
  ],
};

export function getMatchInsights(matchId: string): MatchInsight[] {
  return INSIGHTS[matchId] ?? [];
}
