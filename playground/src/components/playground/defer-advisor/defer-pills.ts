import { slowFieldNames } from './analysis';
import { collectRootFields, getFragments, getOperation, parseQuery } from './operation';

export type FieldPill = {
  fieldName: string;
  offset: number;
  latencyMs: number;
  slow: boolean;
};

export const computeFieldPills = (query: string, latencies: Record<string, number>) => {
  const slowNames = slowFieldNames(latencies);
  const doc = parseQuery(query)?.doc;
  const operation = getOperation(doc);
  if (!operation) {
    return [];
  }

  const pills: FieldPill[] = [];
  for (const field of collectRootFields(operation.selectionSet.selections, getFragments(doc))) {
    const fieldName = field.alias?.value ?? field.name.value;
    const latencyMs = latencies[fieldName];
    if (latencyMs === undefined || !field.name.loc) {
      continue;
    }
    pills.push({ fieldName, offset: field.name.loc.end, latencyMs, slow: slowNames.has(fieldName) });
  }
  return pills;
};
