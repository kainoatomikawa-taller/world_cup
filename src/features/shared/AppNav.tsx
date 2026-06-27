export type AppTab = 'possibilities' | 'fixtures' | 'insights' | 'lineups' | 'ratings';

const TABS: { key: AppTab; label: string }[] = [
  { key: 'possibilities', label: 'Possibilities' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'insights', label: 'Insights' },
  { key: 'lineups', label: 'Lineups' },
  { key: 'ratings', label: 'Ratings' },
];

export function AppNav({
  current,
  onChange,
}: {
  current: AppTab;
  onChange: (key: AppTab) => void;
}) {
  return (
    <nav className="app-nav" aria-label="Main navigation">
      {TABS.map((t) => (
        <button
          key={t.key}
          className="app-nav-tab"
          onClick={() => onChange(t.key)}
          aria-current={current === t.key ? 'page' : undefined}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
