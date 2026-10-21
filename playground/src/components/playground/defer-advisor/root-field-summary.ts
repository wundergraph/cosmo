import { countDeferFragmentsByLabel, listDeferredFields, listNestedDeferLabels } from './defer-transform';
import { collectRootOccurrences, getFragments, getOperation, ParsedQuery } from './operation';

type RootFieldRow = {
  name: string;
  undeferred: number;
  deferredLabels: string[];
  // Eager on a shared label would also un-defer the other fields.
  eagerLabels: string[];
};

export const summarizeRootFields = (parsed: ParsedQuery | undefined): RootFieldRow[] => {
  const operation = getOperation(parsed?.doc);
  if (!parsed || !operation) {
    return [];
  }

  const occurrences = collectRootOccurrences(operation.selectionSet.selections, getFragments(parsed.doc));
  const deferred = listDeferredFields(parsed);
  const names = [...new Set(occurrences.map((o) => o.name))];

  // A label can list a field name twice, so compare distinct names.
  const fragmentCounts = countDeferFragmentsByLabel(parsed);
  const fieldsUnder = (label: string) => new Set(deferred.filter((d) => d.label === label).map((d) => d.field));
  const nestedLabels = listNestedDeferLabels(parsed);
  const isSoleFragment = (label: string) =>
    fragmentCounts.get(label) === 1 && fieldsUnder(label).size === 1 && !nestedLabels.has(label);
  const labelsFor = (name: string) => [...new Set(deferred.filter((d) => d.field === name).map((d) => d.label))];

  return names
    .map((name) => ({
      name,
      undeferred: occurrences.filter((o) => o.name === name && !o.deferred && o.inBody).length,
      deferredLabels: labelsFor(name),
      eagerLabels: labelsFor(name).filter(isSoleFragment),
    }))
    .filter((row) => occurrences.some((o) => o.name === row.name && !o.deferred) || row.deferredLabels.length > 0);
};
