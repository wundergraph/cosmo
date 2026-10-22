import { ASTNode, FieldNode, FragmentDefinitionNode, OperationDefinitionNode, print, visit } from 'graphql';
import { z } from 'zod';
import { collectRootFields, FragmentMap, getFragments, getOperation, parseQuery } from './operation';

export const PROBE_RUNS = 3;

// A router that accepts the connection and never answers would otherwise leave Analyse stuck.
const PROBE_TIMEOUT_MS = 10_000;

type ProbeResult = { ok: true; latencyMs: number } | { ok: false; reason: string };

// What a normal run sends with: the editor headers (already transformed) and variables.
// variablesError explains why the variables were dropped, so the panel can say so.
export type ProbeRequest = {
  headers: Record<string, string>;
  variables: Record<string, unknown>;
  variablesError?: string;
};

const variablesSchema = z.record(z.string(), z.unknown());

// Only the errors matter here. A 2xx body that is not a GraphQL object is a failure, not a measurement.
const responseSchema = z.object({ errors: z.array(z.object({ message: z.string() })).optional() });

// The variables pane is free text while typing. A broken pane probes without values,
// and the router then reports the missing variables for each field.
export const parseVariables = (text: string): Pick<ProbeRequest, 'variables' | 'variablesError'> => {
  let value: unknown;
  try {
    value = JSON.parse(text || '{}');
  } catch {
    return { variables: {}, variablesError: 'Variables are not valid JSON. Probes run without them.' };
  }
  const parsed = variablesSchema.safeParse(value);
  if (!parsed.success) {
    return { variables: {}, variablesError: 'Variables must be a JSON object. Probes run without them.' };
  }
  return { variables: parsed.data };
};

const timeOnce = async (
  url: string,
  query: string,
  variables: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal,
) => {
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
    // The caller's signal lets the panel stop probes when the tab or query changes.
    signal: AbortSignal.any([AbortSignal.timeout(PROBE_TIMEOUT_MS), signal]),
  });
  // A 401 or 429 can carry a JSON body with no errors array, which would otherwise count as a measurement.
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const body = responseSchema.safeParse(await response.json());
  const elapsed = performance.now() - started;

  if (!body.success) {
    throw new Error('Response is not a GraphQL response');
  }
  if (body.data.errors?.length) {
    throw new Error(body.data.errors[0].message);
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

const usedVariableNames = (nodes: readonly ASTNode[]): Set<string> => {
  const names = new Set<string>();
  for (const node of nodes) {
    visit(node, {
      Variable(variable) {
        names.add(variable.name.value);
      },
    });
  }
  return names;
};

// Each field runs alone, so its latency is its own cost. The probe declares only the
// variables its field and fragments use; the router rejects undeclared or unused ones.
const probeField = async (
  url: string,
  field: FieldNode,
  operation: OperationDefinitionNode,
  fragments: FragmentMap,
  request: ProbeRequest,
  signal: AbortSignal,
): Promise<ProbeResult> => {
  const linked = referencedFragments(field, fragments);
  const used = usedVariableNames([field, ...linked]);
  const definitions = (operation.variableDefinitions ?? []).filter((d) => used.has(d.variable.name.value));
  const declared = new Set(definitions.map((d) => d.variable.name.value));
  const variables = Object.fromEntries(Object.entries(request.variables).filter(([name]) => declared.has(name)));

  const head = definitions.length > 0 ? `query(${definitions.map((d) => print(d)).join(', ')}) ` : '';
  const query = [`${head}{ ${print(field)} }`, ...linked.map((f) => print(f))].join('\n');
  try {
    let total = 0;
    for (let run = 0; run < PROBE_RUNS; run++) {
      total += await timeOnce(url, query, variables, request.headers, signal);
    }
    return { ok: true, latencyMs: Math.round(total / PROBE_RUNS) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'probe failed' };
  }
};

export const probeRootFields = async (
  url: string,
  query: string,
  request: ProbeRequest = { headers: {}, variables: {} },
  signal: AbortSignal = new AbortController().signal,
): Promise<Record<string, ProbeResult>> => {
  const doc = parseQuery(query)?.doc;
  const operation = getOperation(doc);
  if (!operation) {
    return {};
  }

  const fragments = getFragments(doc);
  const results: Record<string, ProbeResult> = {};
  for (const field of collectRootFields(operation.selectionSet.selections, fragments)) {
    const name = field.alias?.value ?? field.name.value;
    results[name] = await probeField(url, field, operation, fragments, request, signal);
  }
  return results;
};
