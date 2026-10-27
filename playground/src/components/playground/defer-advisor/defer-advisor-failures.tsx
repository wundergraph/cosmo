type Props = {
  failures: Record<string, string>;
};

export const DeferAdvisorFailures = ({ failures }: Props) => {
  const entries = Object.entries(failures);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded border border-destructive/40 p-3 text-sm">
      <div className="font-medium">Some fields could not be probed</div>
      {entries.map(([name, reason]) => (
        <div key={name} className="text-muted-foreground font-mono text-xs">
          {name}: {reason}
        </div>
      ))}
    </div>
  );
};
