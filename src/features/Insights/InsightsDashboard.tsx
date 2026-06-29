import { useState } from 'react';
import { useFixtures, type StaticFixture } from '../../data/useFixtures';
import { useStandings, type StaticStanding } from '../../data/useStandings';
import { useScorers, type StaticScorer } from '../../data/useScorers';
import { useInsights, type StaticArticle } from '../../data/useInsights';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  group: 'Group Stage',
  round32: 'Round of 32',
  round16: 'Round of 16',
  quarter: 'Quarter-final',
  semi: 'Semi-final',
  thirdPlacePlayoff: '3rd Place Play-off',
  final: 'Final',
};

function formatKickoff(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="insights-section">
      <h2 className="insights-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Skeleton() {
  return <div className="insights-skeleton" aria-busy="true" />;
}

function PanelError({ message }: { message: string }) {
  return <p className="insights-error">Could not load data: {message}</p>;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

function NewsThumb({ url, headline }: { url: string | null; headline: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div className="news-thumb news-thumb--fallback" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 9h18M8 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <img
      className="news-thumb"
      src={url}
      alt={headline}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

function NewsCard({ article }: { article: StaticArticle }) {
  return (
    <a
      className="news-card card"
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${article.headline} — ${article.source_name}`}
    >
      <NewsThumb url={article.thumbnail_url} headline={article.headline} />
      <div className="news-card__body">
        <div className="news-card__meta-top">
          <span className="news-card__source">{article.source_name}</span>
          <span className="news-card__time">{relativeTime(article.published_at)}</span>
        </div>
        <p className="news-card__headline">{article.headline}</p>
        {article.summary && (
          <p className="news-card__summary">{article.summary}</p>
        )}
      </div>
    </a>
  );
}

function NewsPanel({ articles }: { articles: StaticArticle[] }) {
  if (articles.length === 0) {
    return (
      <div className="news-empty">
        <p className="news-empty__msg">
          No news articles yet.{' '}
          <code>python scripts/ingest_news.py</code> to fetch the latest football news.
        </p>
      </div>
    );
  }

  return (
    <div className="news-feed">
      {articles.map((a) => (
        <NewsCard key={a.id} article={a} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming Fixtures panel
// ---------------------------------------------------------------------------

function FixturesPanel({ fixtures }: { fixtures: StaticFixture[] }) {
  const upcoming = fixtures.filter((f) => !f.played).slice(0, 10);

  const byDate = upcoming.reduce<Record<string, StaticFixture[]>>((acc, f) => {
    const { date } = formatKickoff(f.kickoff);
    (acc[date] ??= []).push(f);
    return acc;
  }, {});

  if (upcoming.length === 0) {
    return <p className="screen-intro">No upcoming fixtures.</p>;
  }

  return (
    <div className="insights-fixtures">
      {Object.entries(byDate).map(([date, matches]) => (
        <div key={date} className="insights-fixture-day">
          <div className="insights-fixture-date">{date}</div>
          {matches.map((f) => {
            const { time } = formatKickoff(f.kickoff);
            const stageLabel = STAGE_LABELS[f.stage] ?? f.stage;
            return (
              <div key={f.match_id} className="insights-fixture-row card">
                <span className="insights-fixture-stage">{stageLabel}</span>
                <span className="insights-fixture-team insights-fixture-team--home">
                  <span className="insights-fixture-flag">{f.home_flag}</span>
                  <span className="insights-fixture-name">{f.home_team}</span>
                </span>
                <span className="insights-fixture-vs">vs</span>
                <span className="insights-fixture-team insights-fixture-team--away">
                  <span className="insights-fixture-name">{f.away_team}</span>
                  <span className="insights-fixture-flag">{f.away_flag}</span>
                </span>
                <span className="insights-fixture-time">{time}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Standings panel
// ---------------------------------------------------------------------------

function GroupCard({ groupId, rows }: { groupId: string; rows: StaticStanding[] }) {
  const sorted = [...rows].sort((a, b) => {
    if (a.position != null && b.position != null) return a.position - b.position;
    return b.points - a.points;
  });

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-head__title">Group {groupId}</span>
      </div>
      <table className="insights-standings-table tnum">
        <thead>
          <tr>
            <th className="ist-col-team" />
            <th title="Played">P</th>
            <th title="Won">W</th>
            <th title="Drawn">D</th>
            <th title="Lost">L</th>
            <th title="Goal difference">GD</th>
            <th title="Points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.code} className={i < 2 ? 'ist-row--qualifies' : ''}>
              <td className="ist-col-team">
                <span className="insights-fixture-flag">{row.flag}</span>
                <span className="ist-team-name">{row.team}</span>
                <span className="ist-team-code">{row.code}</span>
              </td>
              <td>{row.played}</td>
              <td>{row.won}</td>
              <td>{row.drawn}</td>
              <td>{row.lost}</td>
              <td className={row.goal_diff > 0 ? 'ist-pos' : row.goal_diff < 0 ? 'ist-neg' : ''}>
                {row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}
              </td>
              <td className="ist-pts">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingsPanel({ standings }: { standings: StaticStanding[] }) {
  const byGroup = standings.reduce<Record<string, StaticStanding[]>>((acc, row) => {
    (acc[row.group_id] ??= []).push(row);
    return acc;
  }, {});

  return (
    <div className="group-grid">
      {Object.entries(byGroup)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([groupId, rows]) => (
          <GroupCard key={groupId} groupId={groupId} rows={rows} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Scorers panel
// ---------------------------------------------------------------------------

function ScorersPanel({ scorers }: { scorers: StaticScorer[] }) {
  return (
    <div className="card">
      <table className="insights-scorers-table tnum">
        <thead>
          <tr>
            <th className="ist-col-rank">#</th>
            <th className="ist-col-player">Player</th>
            <th title="Goals">G</th>
            <th title="Assists">A</th>
            <th title="Penalties scored">Pen</th>
          </tr>
        </thead>
        <tbody>
          {scorers.map((s) => (
            <tr key={`${s.player_name}-${s.team_code}`}>
              <td className="ist-col-rank ist-rank">{s.rank}</td>
              <td className="ist-col-player">
                <span className="insights-fixture-flag">{s.team_flag}</span>
                <span className="ist-player-name">{s.player_name}</span>
                <span className="ist-team-code">{s.team_code}</span>
              </td>
              <td className="ist-goals">{s.goals}</td>
              <td>{s.assists}</td>
              <td>{s.penalties || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match Day helpers
// ---------------------------------------------------------------------------

function getTodayFixtures(fixtures: StaticFixture[]): StaticFixture[] {
  const today = new Date().toISOString().slice(0, 10);
  return fixtures.filter((f) => f.kickoff.startsWith(today));
}

function splitArticlesByMatchDay(
  articles: StaticArticle[],
  todayFixtures: StaticFixture[],
): { featured: StaticArticle[]; rest: StaticArticle[] } {
  if (todayFixtures.length === 0) return { featured: [], rest: articles };
  const teamIds = new Set(
    todayFixtures.flatMap((f) => [f.home_team_id, f.away_team_id]),
  );
  const featured = articles.filter((a) => a.teams.some((t) => teamIds.has(t)));
  const featuredIds = new Set(featured.map((a) => a.id));
  const rest = articles.filter((a) => !featuredIds.has(a.id));
  return { featured, rest };
}

// ---------------------------------------------------------------------------
// Match Day section
// ---------------------------------------------------------------------------

function MatchDaySection({
  fixtures,
  articles,
}: {
  fixtures: StaticFixture[];
  articles: StaticArticle[];
}) {
  return (
    <section className="insights-section insights-section--matchday">
      <div className="insights-matchday-header">
        <span className="insights-matchday-badge">Today</span>
        <h2 className="insights-section-title insights-section-title--gold">
          Match Day
        </h2>
      </div>

      <div className="insights-matchday-chips">
        {fixtures.map((f) => {
          const { time } = formatKickoff(f.kickoff);
          const played = f.played === 1;
          return (
            <div
              key={f.match_id}
              className={`insights-matchday-chip${played ? ' insights-matchday-chip--played' : ''}`}
            >
              <span className="insights-matchday-chip__team">
                <span className="insights-matchday-chip__flag">{f.home_flag}</span>
                {f.home_team}
              </span>
              <span className="insights-matchday-chip__score">
                {played
                  ? `${f.home_goals ?? 0} – ${f.away_goals ?? 0}`
                  : time}
              </span>
              <span className="insights-matchday-chip__team insights-matchday-chip__team--away">
                {f.away_team}
                <span className="insights-matchday-chip__flag">{f.away_flag}</span>
              </span>
            </div>
          );
        })}
      </div>

      {articles.length > 0 ? (
        <div className="news-feed">
          {articles.map((a) => (
            <NewsCard key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <p className="insights-matchday-empty">
          No match coverage yet — check back closer to kick-off.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export function InsightsDashboard() {
  const { articles, loading: nLoading, error: nError } = useInsights();
  const { fixtures, loading: fLoading, error: fError } = useFixtures();
  const { standings, loading: sLoading, error: sError } = useStandings();
  const { scorers, loading: scLoading, error: scError } = useScorers();

  const todayFixtures =
    !fLoading && !fError ? getTodayFixtures(fixtures) : [];

  const { featured: matchDayArticles, rest: latestArticles } =
    !nLoading && !nError && todayFixtures.length > 0
      ? splitArticlesByMatchDay(articles, todayFixtures)
      : { featured: [], rest: articles };

  const showMatchDay = todayFixtures.length > 0;

  return (
    <div className="insights-dashboard">
      {showMatchDay && (
        <>
          {nLoading && <Skeleton />}
          {!nLoading && !nError && (
            <MatchDaySection
              fixtures={todayFixtures}
              articles={matchDayArticles}
            />
          )}
        </>
      )}

      <Section title="Latest News">
        {nLoading && <Skeleton />}
        {nError && <PanelError message={nError} />}
        {!nLoading && !nError && <NewsPanel articles={latestArticles} />}
      </Section>

      <Section title="Upcoming Fixtures">
        {fLoading && <Skeleton />}
        {fError && <PanelError message={fError} />}
        {!fLoading && !fError && <FixturesPanel fixtures={fixtures} />}
      </Section>

      <Section title="Group Standings">
        {sLoading && <Skeleton />}
        {sError && <PanelError message={sError} />}
        {!sLoading && !sError && <StandingsPanel standings={standings} />}
      </Section>

      <Section title="Top Scorers">
        {scLoading && <Skeleton />}
        {scError && <PanelError message={scError} />}
        {!scLoading && !scError && <ScorersPanel scorers={scorers} />}
      </Section>
    </div>
  );
}
