import { Button } from '../../ui/button';
import type { RootFieldRow } from './root-field-summary';

type Props = {
  rows: RootFieldRow[];
  latencies: Record<string, number> | null;
  slowNames: Set<string>;
  onDefer: (name: string) => void;
  onRevert: (label: string) => void;
};

export const DeferAdvisorLatencies = ({ rows, latencies, slowNames, onDefer, onRevert }: Props) => (
  <div className="flex flex-col gap-2">
    {rows.map(({ name, undeferred, deferredLabels, eagerLabels }) => {
      const latency = latencies?.[name];
      return (
        <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded border p-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm">{name}</div>
            {latency !== undefined && (
              <div className="text-muted-foreground text-xs">
                {latency}ms{slowNames.has(name) ? ' · slow' : ''}
              </div>
            )}
            {deferredLabels.map((label) => (
              <div key={label} className="truncate font-mono text-xs">{`@defer(label: "${label}")`}</div>
            ))}
          </div>
          <div className="flex gap-2">
            {undeferred > 0 && (
              <Button size="sm" className="whitespace-nowrap" onClick={() => onDefer(name)}>
                Defer
              </Button>
            )}
            {eagerLabels.map((label) => (
              <Button
                key={label}
                variant="secondary"
                size="sm"
                className="whitespace-nowrap"
                onClick={() => onRevert(label)}
              >
                {eagerLabels.length > 1 ? `Eager ${label}` : 'Eager'}
              </Button>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);
