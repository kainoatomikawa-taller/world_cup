import { getMatchInsights, type InsightCategory, type MatchInsight } from '../../data/matchInsights';
import type { StaticMatchDetail } from '../../data/staticTypes';

const CATEGORY_LABEL: Record<InsightCategory, string> = {
  tactical: 'Tactical',
  stats: 'Stats',
  player: 'Player',
  news: 'News',
};

function InsightCard({ insight }: { insight: MatchInsight }) {
  return (
    <a
      className="card mit-card"
      href={insight.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="mit-card-meta">
        <span className="mit-source">{insight.source}</span>
        <span className={`mit-badge mit-badge--${insight.category}`}>
          {CATEGORY_LABEL[insight.category]}
        </span>
      </div>
      <div className="mit-card-title">{insight.title}</div>
      {insight.description && (
        <div className="mit-card-desc">{insight.description}</div>
      )}
    </a>
  );
}

export function InsightsTab({ detail }: { detail: StaticMatchDetail }) {
  const insights = getMatchInsights(detail.match_id);

  if (insights.length === 0) {
    return (
      <div className="placeholder-screen">
        <p className="placeholder-desc">
          No insights are available for this match yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mit-list">
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  );
}
