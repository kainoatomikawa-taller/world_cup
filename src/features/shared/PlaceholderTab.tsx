export function PlaceholderTab({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="placeholder-screen">
      <h2 className="placeholder-title">{title}</h2>
      <p className="placeholder-desc">{description}</p>
    </div>
  );
}
