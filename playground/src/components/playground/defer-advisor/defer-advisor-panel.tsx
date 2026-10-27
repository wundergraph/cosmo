import { useMemo } from 'react';
import { Kind } from 'graphql';
import { Button } from '../../ui/button';
import { slowFieldNames } from './analysis';
import { applyDefer, listDeferLabels, makeUniqueLabel, revertDefer } from './defer-transform';
import { getOperation, parseQuery } from './operation';
import { DeferAdvisorFailures } from './defer-advisor-failures';
import { DeferAdvisorLatencies } from './defer-advisor-latencies';
import type { ProbeRequest } from './probe';
import { summarizeRootFields } from './root-field-summary';
import { useDeferAdvisor } from './use-defer-advisor';

type Props = {
  query: string;
  routingUrl: string;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
  onQueryChange: (query: string) => void;
};

export const DeferAdvisorPanel = ({ query, routingUrl, getRequest, onQueryChange }: Props) => {
  const { latencies, probeFailures, error, running, analyse, clear } = useDeferAdvisor({
    query,
    routingUrl,
    getRequest,
  });

  const parsed = useMemo(() => parseQuery(query), [query]);
  const doc = parsed?.doc;
  const operation = useMemo(() => getOperation(doc), [doc]);
  const operationCount = doc?.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION).length ?? 0;
  const isMutationOrSubscription = operation?.operation === 'mutation' || operation?.operation === 'subscription';
  // A comment-only document fails to parse but has nothing to fix.
  const hasSyntaxError = doc === undefined && !query.split('\n').every((line) => /^\s*(#.*)?$/.test(line));

  const rows = useMemo(() => summarizeRootFields(parsed), [parsed]);

  const slowNames = useMemo(() => (latencies ? slowFieldNames(latencies) : new Set<string>()), [latencies]);

  const deferField = (name: string) => {
    if (!parsed) {
      return;
    }
    const label = makeUniqueLabel(name, new Set(listDeferLabels(parsed)));
    onQueryChange(applyDefer(parsed, name, label));
  };

  const revertLabel = (label: string) => {
    if (!parsed) {
      return;
    }
    onQueryChange(revertDefer(parsed, label));
  };

  const emptyNotice =
    query.trim() === '' ? 'Write a query to see its root fields here.' : 'No root fields to show here.';

  const canAnalyse = !running && rows.length > 0;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold whitespace-nowrap">Defer Advisor</span>
        {!isMutationOrSubscription && !hasSyntaxError && (
          <div className="flex flex-wrap gap-2 whitespace-nowrap">
            <Button onClick={analyse} disabled={!canAnalyse}>
              {running ? 'Analysing...' : latencies ? 'Re-analyse' : 'Analyse operation'}
            </Button>
            {latencies && (
              <Button variant="secondary" onClick={clear} disabled={running}>
                Clear
              </Button>
            )}
          </div>
        )}
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

          {error && <p className="text-destructive text-sm">{error}</p>}

          {latencies && <DeferAdvisorFailures failures={probeFailures} />}

          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{emptyNotice}</p>
          ) : (
            <DeferAdvisorLatencies
              rows={rows}
              latencies={latencies}
              slowNames={slowNames}
              onDefer={deferField}
              onRevert={revertLabel}
            />
          )}

          {latencies && Object.keys(latencies).length > 0 && rows.length > 0 && slowNames.size === 0 && (
            <p className="text-muted-foreground text-sm">No slow fields found. Nothing to defer.</p>
          )}
        </>
      )}
    </div>
  );
};
