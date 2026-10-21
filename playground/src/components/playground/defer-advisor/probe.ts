import { ASTNode, FieldNode, FragmentDefinitionNode, print, visit } from 'graphql';
import { collectRootFields, FragmentMap, getFragments, getOperation, parseQuery } from './operation';

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

// Fragments the field reaches, directly or through other fragments. The probe
// document must define them or the router rejects it.
const referencedFragments = (field: FieldNode, fragments: FragmentMap): FragmentDefinitionNode[] => {
  const found = new Map<string, FragmentDefinitionNode>();
  const collect = (node: ASTNode) => {
    visit(node, {
      FragmentSpread(spread) {
        const name = spread.name.value;
        const fragment = fragments.get(name);
        if (!fragment || found.has(name)) {
          return;
        }
        found.set(name, fragment);
        collect(fragment);
      },
    });
  };
  collect(field);
  return [...found.values()];
};

// Each field runs alone, so its latency is its own cost.
const probeField = async (url: string, field: FieldNode, fragments: FragmentMap): Promise<ProbeResult> => {
  const query = [`{ ${print(field)} }`, ...referencedFragments(field, fragments).map((f) => print(f))].join('\n');
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
  const doc = parseQuery(query)?.doc;
  const operation = getOperation(doc);
  if (!operation) {
    return {};
  }

  const fragments = getFragments(doc);
  const results: Record<string, ProbeResult> = {};
  for (const field of collectRootFields(operation.selectionSet.selections, fragments)) {
    const name = field.alias?.value ?? field.name.value;
    results[name] = await probeField(url, field, fragments);
  }
  return results;
};
