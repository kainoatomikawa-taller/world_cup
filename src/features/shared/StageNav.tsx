export type StageKey = 'possibilities' | 'fixtures' | 'insights' | 'stats';

const STAGES: { key: StageKey; label: string }[] = [
  { key: 'possibilities', label: 'Possibilities' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'insights', label: 'Insights' },
  { key: 'stats', label: 'Stats' },
];

export function StageNav({
  current,
  onChange,
}: {
  current: StageKey;
  onChange: (key: StageKey) => void;
}) {
  return (
    <nav className="stage-nav">
      {STAGES.map((s) => (
        <button
          key={s.key}
          className="stage-tab"
          onClick={() => onChange(s.key)}
          aria-current={current === s.key}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
