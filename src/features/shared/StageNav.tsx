// Simple navigation between the four screens of the experience.
export type StageKey = 'fixtures' | 'groups' | 'thirdPlace' | 'bracket';

const STAGES: { key: StageKey; label: string }[] = [
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'groups', label: 'Group stage' },
  { key: 'thirdPlace', label: 'Third place' },
  { key: 'bracket', label: 'Knockout' },
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
