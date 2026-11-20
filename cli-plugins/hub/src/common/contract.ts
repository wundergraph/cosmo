import { z } from 'zod';

/**
 * Every Hub MCP tool, argument and result shape the hub commands assume, in one place. Hub's
 * operation API is still being built; when its contract changes, this file is the one to edit.
 */
export const hubTools = {
  launchSandbox: 'launch_sandbox',
  exportSandboxConfig: 'export_sandbox_config',
  describeSandbox: 'describe_sandbox',
  listSandboxes: 'list_sandboxes',
  getSandboxLogs: 'get_sandbox_logs',
  listSandboxHistory: 'list_sandbox_history',
  getOperation: 'get_operation',
  cancelOperation: 'cancel_operation',
  listOperations: 'list_operations',
  runCollection: 'run_collection',
  createProposal: 'create_proposal',
} as const;

/** How long one `get_operation` or `get_sandbox_logs` call may hold the request open for news. */
export const longPollSeconds = 30;

export const operationStatuses = ['queued', 'running', 'input_required', 'succeeded', 'failed', 'cancelled'] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export const stepStatuses = ['pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'] as const;

export type StepStatus = (typeof stepStatuses)[number];

const stepShape = z
  .object({
    name: z.string(),
    status: z.enum(stepStatuses),
    duration_ms: z.number().nullable(),
    detail: z.string().nullable(),
  })
  .transform((step) => ({
    name: step.name,
    status: step.status,
    durationMs: step.duration_ms,
    detail: step.detail,
  }));

export type OperationStep = z.output<typeof stepShape>;

const eventShape = z.object({ at: z.string(), message: z.string(), step: z.string().nullable() });

export type OperationEvent = z.output<typeof eventShape>;

const errorShape = z
  .object({
    code: z.string(),
    message: z.string(),
    remediation: z.string().nullable().optional(),
    cli: z.string().nullable().optional(),
    docs_url: z.string().nullable().optional(),
  })
  .transform((error) => ({
    code: error.code,
    message: error.message,
    remediation: error.remediation ?? undefined,
    fix: error.cli ?? undefined,
    docs: error.docs_url ?? undefined,
  }));

export type OperationError = z.output<typeof errorShape>;

export const surfaces = ['cli', 'ui', 'mcp'] as const;

export type Surface = (typeof surfaces)[number];

/** One run of a Hub action, e.g. a sandbox launch: the same record the Hub UI and MCP render. */
export const operationShape = z
  .object({
    operation_id: z.string(),
    kind: z.string(),
    status: z.enum(operationStatuses),
    steps: z.array(stepShape),
    events: z.array(eventShape),
    url: z.string(),
    origin: z.object({ surface: z.enum(surfaces), client: z.string().nullable() }),
    error: errorShape.nullable(),
    started_at: z.string(),
    finished_at: z.string().nullable(),
  })
  .transform((operation) => ({
    id: operation.operation_id,
    kind: operation.kind,
    status: operation.status,
    steps: operation.steps,
    events: operation.events,
    url: operation.url,
    origin: operation.origin,
    error: operation.error,
    startedAt: operation.started_at,
    finishedAt: operation.finished_at,
  }));

export type Operation = z.output<typeof operationShape>;

const sandboxSummaryShape = z
  .object({
    sandbox_id: z.string(),
    name: z.string(),
    status: z.string(),
    org_slug: z.string(),
    graph_slug: z.string(),
    url: z.string(),
    graphql_url: z.string().nullable(),
  })
  .transform((sandbox) => ({
    sandboxId: sandbox.sandbox_id,
    name: sandbox.name,
    status: sandbox.status,
    orgSlug: sandbox.org_slug,
    graphSlug: sandbox.graph_slug,
    url: sandbox.url,
    graphqlUrl: sandbox.graphql_url,
  }));

export type SandboxSummary = z.output<typeof sandboxSummaryShape>;

const sandboxDetailsShape = z
  .object({
    sandbox_id: z.string(),
    name: z.string(),
    status: z.string(),
    org_slug: z.string(),
    graph_slug: z.string(),
    url: z.string(),
    graphql_url: z.string().nullable(),
    router_version: z.string(),
    latest_router_version: z.string().nullable(),
    sources: z.array(z.object({ name: z.string(), status: z.enum(['ok', 'failing']) })),
    collections: z.array(z.string()),
    last_operation: z
      .object({
        operation_id: z.string(),
        kind: z.string(),
        status: z.enum(operationStatuses),
        finished_at: z.string().nullable(),
      })
      .nullable(),
  })
  .transform((sandbox) => ({
    sandboxId: sandbox.sandbox_id,
    name: sandbox.name,
    status: sandbox.status,
    orgSlug: sandbox.org_slug,
    graphSlug: sandbox.graph_slug,
    url: sandbox.url,
    graphqlUrl: sandbox.graphql_url,
    routerVersion: sandbox.router_version,
    latestRouterVersion: sandbox.latest_router_version,
    sources: sandbox.sources,
    collections: sandbox.collections,
    lastOperation:
      sandbox.last_operation === null
        ? null
        : {
            id: sandbox.last_operation.operation_id,
            kind: sandbox.last_operation.kind,
            status: sandbox.last_operation.status,
            finishedAt: sandbox.last_operation.finished_at,
          },
  }));

export type SandboxDetails = z.output<typeof sandboxDetailsShape>;

const historyEntryShape = z.object({
  version: z.string(),
  summary: z.string(),
  surface: z.enum(surfaces),
  actor: z.string(),
  at: z.string(),
});

export type HistoryEntry = z.output<typeof historyEntryShape>;

const logLineShape = z.object({ at: z.string(), component: z.enum(['router', 'forge']), message: z.string() });

export type LogLine = z.output<typeof logLineShape>;

/** Result shapes per tool. Arguments are documented on the commands that send them. */
export const hubResults = {
  /** `{ graph, name, sandbox_yaml, from_sandbox_id?, idempotency_key }` */
  launchSandbox: z.object({ sandbox: sandboxSummaryShape, operation: operationShape }),
  /** `{ graph }` */
  exportSandboxConfig: z
    .object({ sandbox_yaml: z.string(), router_version: z.string(), sources: z.array(z.string()) })
    .transform((config) => ({
      sandboxYaml: config.sandbox_yaml,
      routerVersion: config.router_version,
      sources: config.sources,
    })),
  /** `{ sandbox_id }`, where Hub also accepts the sandbox name */
  describeSandbox: z.object({ sandbox: sandboxDetailsShape }),
  /** `{ graph }` */
  listSandboxes: z.object({ sandboxes: z.array(sandboxSummaryShape) }),
  /** `{ sandbox_id, since?, component?, cursor?, wait_seconds? }` */
  getSandboxLogs: z
    .object({ lines: z.array(logLineShape), next_cursor: z.string().nullable() })
    .transform((logs) => ({ lines: logs.lines, nextCursor: logs.next_cursor })),
  /** `{ sandbox_id }` */
  listSandboxHistory: z.object({ entries: z.array(historyEntryShape) }),
  /** `{ operation_id, wait_seconds? }`: answers once the operation changes or the wait ends */
  getOperation: z.object({ operation: operationShape }),
  /** `{ operation_id }`: returns the operation unchanged when it already finished */
  cancelOperation: z.object({ operation: operationShape }),
  /** `{ sandbox_id }`, newest first */
  listOperations: z.object({ operations: z.array(operationShape) }),
  /** `{ sandbox_id, collection, idempotency_key }`: one step per collection operation */
  runCollection: z.object({ operation: operationShape }),
  /** `{ sandbox_id, title?, body?, idempotency_key }`: `created` is false when the sandbox already has an open proposal */
  createProposal: z.object({
    proposal: z.object({ number: z.number(), url: z.string() }),
    created: z.boolean(),
    changes: z.object({ total: z.number(), breaking: z.number() }),
  }),
};

/** The JSON answer of `POST /ci/schema-push`, which CI calls with `{ sandboxYaml, subgraphs, sha }`. */
export const schemaPushResult = z.object({
  sandbox: z.object({ name: z.string(), url: z.string() }),
  composition: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }),
});

export interface SandboxLocation {
  orgSlug: string;
  graphSlug: string;
  sandboxId: string;
}

/** Hub's page URLs. Every object a command prints or opens links to one of these. */
export const hubPages = (hubUrl: string, location: SandboxLocation) => {
  const base = hubUrl.replace(/\/+$/, '');
  const graph = `${base}/${location.orgSlug}/graph/${location.graphSlug}`;
  const sandbox = `${graph}/sandboxes/${location.sandboxId}`;

  return {
    sandbox,
    history: `${sandbox}/history`,
    operation: (operationId: string) => `${sandbox}/operations/${operationId}`,
    proposal: (proposalNumber: string) => `${graph}/proposals/${proposalNumber}`,
  };
};
