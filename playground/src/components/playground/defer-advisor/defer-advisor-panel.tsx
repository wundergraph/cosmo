import { useMemo } from 'react';
import { Kind } from 'graphql';
import { Button } from '../../ui/button';
import { applyDefer, listDeferLabels, makeUniqueLabel, revertDefer } from './defer-transform';
import { getOperation, safeParseQuery } from './operation';
import { summarizeRootFields } from './root-field-summary';

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
};

export const DeferAdvisorPanel = ({ query, onQueryChange }: Props) => {
  const doc = useMemo(() => safeParseQuery(query), [query]);
  const operation = useMemo(() => getOperation(doc), [doc]);
  const operationCount = doc?.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION).length ?? 0;
  const isMutationOrSubscription = operation?.operation === 'mutation' || operation?.operation === 'subscription';
  // A comment-only document fails to parse but has nothing to fix.
  const hasSyntaxError = doc === undefined && !/^(\s|#[^\n]*)*$/.test(query);

  const rows = useMemo(() => summarizeRootFields(query), [query]);

  const deferField = (name: string) => {
    const label = makeUniqueLabel(name, new Set(listDeferLabels(query)));
    onQueryChange(applyDefer(query, name, label));
  };

  const emptyNotice =
    query.trim() === '' ? 'Write a query to see its root fields here.' : 'No root fields to show here.';

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Defer</span>
      </div>

      {isMutationOrSubscription ? (
        <p className="text-muted-foreground text-sm">
          Defer only works on read-only queries. Mutations and subscriptions are not changed.
        </p>
      ) : hasSyntaxError ? (
        <p className="text-muted-foreground text-sm">Fix the syntax error to see the root fields here.</p>
      ) : (
        <>
          {operationCount > 1 && (
            <p className="text-muted-foreground text-sm">
              This document has {operationCount} operations. Defer only reads the first one.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{emptyNotice}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map(({ name, undeferred, deferredLabels, eagerLabels }) => (
                <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded border p-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm">{name}</div>
                    {deferredLabels.map((label) => (
                      <div key={label} className="truncate font-mono text-xs">{`@defer(label: "${label}")`}</div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {undeferred > 0 && (
                      <Button size="sm" className="whitespace-nowrap" onClick={() => deferField(name)}>
                        Defer
                      </Button>
                    )}
                    {eagerLabels.map((label) => (
                      <Button
                        key={label}
                        variant="secondary"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => onQueryChange(revertDefer(query, label))}
                      >
                        {eagerLabels.length > 1 ? `Eager ${label}` : 'Eager'}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
