import { FieldNode, print } from 'graphql';
import { collectRootFields, getOperation, parseQuery } from './operation';

export const PROBE_RUNS = 3;

type ProbeResult = { ok: true; latencyMs: number } | { ok: false; reason: string };

const timeOnce = async (url: string, query: string): Promise<number> => {
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.json();
  const elapsed = performance.now() - started;

  if (body?.errors?.length) {
    throw new Error(String(body.errors[0].message));
  }
  return elapsed;
};

// Each field runs alone, so its latency is its own cost.
const probeField = async (url: string, field: FieldNode): Promise<ProbeResult> => {
  const query = `{ ${print(field)} }`;
  try {
    let total = 0;
    for (let run = 0; run < PROBE_RUNS; run++) {
      total += await timeOnce(url, query);
    }
    return { ok: true, latencyMs: Math.round(total / PROBE_RUNS) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'probe failed' };
  }
};

export const probeRootFields = async (url: string, query: string): Promise<Record<string, ProbeResult>> => {
  const operation = getOperation(parseQuery(query)?.doc);
  if (!operation) {
    return {};
  }

  const results: Record<string, ProbeResult> = {};
  for (const field of collectRootFields(operation.selectionSet.selections)) {
    const name = field.alias?.value ?? field.name.value;
    results[name] = await probeField(url, field);
  }
  return results;
};
