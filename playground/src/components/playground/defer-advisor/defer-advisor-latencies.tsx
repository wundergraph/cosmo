import { GiSnail } from 'react-icons/gi';
import { Badge } from '../../ui/badge';
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
        <div key={name} className="flex flex-col gap-2 rounded border p-3">
          <div className="flex min-h-6 items-center gap-2">
            <div className="min-w-0 break-all font-mono text-sm">{name}</div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {slowNames.has(name) && deferredLabels.length === 0 && (
                <GiSnail className="text-muted-foreground size-4" title="Slow" aria-label="Slow" />
              )}
              {deferredLabels.map((label) => (
                <Badge key={label} variant="muted" className="max-w-full truncate rounded-full font-mono font-normal">
                  {label}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
            {undeferred > 0 && (
              <Button size="sm" onClick={() => onDefer(name)}>
                Defer
              </Button>
            )}
            {eagerLabels.map((label) => (
              <Button key={label} variant="secondary" size="sm" onClick={() => onRevert(label)}>
                {eagerLabels.length > 1 ? `Remove Defer ${label}` : 'Remove Defer'}
              </Button>
            ))}
            {latency !== undefined && (
              <span className="text-muted-foreground ml-auto whitespace-nowrap text-xs">{latency}ms</span>
            )}
          </div>
        </div>
      );
    })}
  </div>
);
