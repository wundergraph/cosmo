import { z } from 'zod';

/**
 * Every Hub MCP tool, argument and result shape the hub commands assume, in one place. When Hub's
 * contract changes, this file is the one to edit. Hub names a sandbox `<schema>/<sandbox>`.
 */
export const hubTools = {
  launchSandbox: 'launch_sandbox',
  exportSandboxConfig: 'export_sandbox_config',
  getSandbox: 'get_sandbox',
  listSandboxes: 'list_sandboxes',
  streamLogs: 'stream_logs',
  listSandboxHistory: 'list_sandbox_history',
  getOperation: 'get_operation',
  cancelOperation: 'cancel_operation',
  listOperations: 'list_operations',
  runCollection: 'run_collection',
  createProposal: 'create_proposal',
  openPortal: 'open_portal',
  closePortal: 'close_portal',
  listPortals: 'list_portals',
  describeCurrentAccess: 'describe_current_access',
} as const;

/** How long one `stream_logs` call may hold the request open for the next line; Hub allows up to 30. */
export const logWaitSeconds = 30;

export const operationStatuses = [
  'queued',
  'running',
  'needs_approval',
  'needs_input',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export const stepStatuses = ['running', 'succeeded', 'failed', 'skipped'] as const;

export type StepStatus = (typeof stepStatuses)[number];

const origins = ['ui', 'cli', 'mcp', 'ci', 'integration', 'system'] as const;

const operationSummaryFields = {
  operationId: z.string(),
  kind: z.string(),
  status: z.enum(operationStatuses),
  title: z.string(),
  origin: z.enum(origins),
  sandbox: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  dashboardUrl: z.string(),
};

/** One run of a Hub action, e.g. a sandbox launch, as `list_operations` and `cancel_operation` return it. */
const operationSummaryShape = z.object(operationSummaryFields).transform((operation) => ({
  id: operation.operationId,
  kind: operation.kind,
  status: operation.status,
  title: operation.title,
  origin: operation.origin,
  sandbox: operation.sandbox,
  createdAt: operation.createdAt,
  finishedAt: operation.finishedAt,
  url: operation.dashboardUrl,
}));

/** An operation with its steps, error and approval, as `get_operation` returns it. */
const operationShape = z
  .object({
    ...operationSummaryFields,
    steps: z.array(z.object({ label: z.string(), status: z.enum(stepStatuses), detail: z.string() })),
    error: z.object({ code: z.string(), message: z.string(), remediation: z.string().nullable() }).nullable(),
    approval: z.object({ reason: z.string() }).nullable(),
  })
  .transform((operation) => ({
    id: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    title: operation.title,
    origin: operation.origin,
    sandbox: operation.sandbox,
    createdAt: operation.createdAt,
    finishedAt: operation.finishedAt,
    url: operation.dashboardUrl,
    steps: operation.steps.map((step) => ({ name: step.label, status: step.status, detail: step.detail })),
    error: operation.error,
    approvalReason: operation.approval?.reason ?? null,
  }));

export type Operation = z.output<typeof operationShape>;

export type OperationStep = Operation['steps'][number];

const routerStatuses = ['live', 'ready', 'starting', 'failed'] as const;

const sandboxRowShape = z.object({
  address: z.string(),
  schema: z.string(),
  name: z.string(),
  source: z.object({ kind: z.enum(['schema', 'sandbox', 'cosmo']), name: z.string(), deleted: z.boolean() }).nullable(),
  routerStatus: z.enum(routerStatuses),
  endpointUrl: z.string(),
});

export const logSources = ['router', 'agent', 'boot', 'build', 'command'] as const;

export type LogSource = (typeof logSources)[number];

const logLineShape = z.object({
  at: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  source: z.enum(logSources),
  message: z.string(),
});

export type LogLine = z.output<typeof logLineShape>;

const historyEntryShape = z.object({
  seq: z.number(),
  operationId: z.string(),
  author: z.object({ kind: z.enum(['user', 'agent', 'system']), userId: z.string().nullable() }),
  agentName: z.string().nullable(),
  createdAt: z.string(),
  kind: z.string(),
  verdict: z.enum(['applied', 'refused']),
  refusalReason: z.string().nullable(),
});

const collectionResultShape = z.object({
  collection: z.string(),
  operation: z.string(),
  passed: z.boolean(),
  status: z.number(),
  durationMs: z.number(),
  error: z.string().nullable(),
});

export type CollectionResult = z.output<typeof collectionResultShape>;

export const portalStatuses = ['connecting', 'connected', 'disconnected', 'closed'] as const;

export type PortalStatus = (typeof portalStatuses)[number];

/** One subgraph of a sandbox served from outside Hub. */
const portalShape = z.object({
  portalId: z.string(),
  subgraph: z.string(),
  status: z.enum(portalStatuses),
  upstream: z.enum(['tunnel', 'url']),
  openedBy: z.string().nullable(),
  lastRequestAt: z.string().nullable(),
  operationId: z.string().nullable(),
});

export type Portal = z.output<typeof portalShape>;

/** Result shapes per tool, each with the arguments the commands send. */
export const hubResults = {
  /** `{ from, name, idempotency_key }`: `from` is a schema slug or `<schema>/<sandbox>` */
  launchSandbox: z
    .object({
      ...sandboxRowShape.shape,
      url: z.string(),
      operationId: z.string(),
      status: z.enum(operationStatuses),
      dashboardUrl: z.string(),
    })
    .transform((launched) => ({
      sandbox: { address: launched.address, name: launched.name, endpointUrl: launched.endpointUrl, url: launched.url },
      operation: { id: launched.operationId, status: launched.status, url: launched.dashboardUrl },
    })),
  /** `{ sandbox }`, where a schema slug alone exports the schema */
  exportSandboxConfig: z
    .object({ sandbox_yaml: z.string(), router_version: z.string(), sources: z.array(z.string()) })
    .transform((config) => ({
      sandboxYaml: config.sandbox_yaml,
      routerVersion: config.router_version,
      sources: config.sources,
    })),
  /** `{ sandbox }`: the endpoint token Hub may add is dropped here, so no command prints it */
  getSandbox: z.object({ address: z.string(), endpointUrl: z.string(), routerStatus: z.enum(routerStatuses) }),
  /** `{ schema }` */
  listSandboxes: z.object({ sandboxes: z.array(sandboxRowShape) }),
  /** `{ sandbox, sources?, cursor?, wait_seconds? }`: `wait_seconds` holds the call open only with `cursor` */
  streamLogs: z
    .object({
      notice: z.string(),
      untrustedData: z.object({ lines: z.array(logLineShape), cursor: z.string() }),
    })
    .transform((logs) => ({ notice: logs.notice, lines: logs.untrustedData.lines, cursor: logs.untrustedData.cursor })),
  /** `{ sandbox }`, oldest first */
  listSandboxHistory: z.object({ entries: z.array(historyEntryShape) }),
  /** `{ operationId }`: answers at once, so following an operation polls */
  getOperation: operationShape,
  /** `{ operationId }`: Hub refuses to cancel builds, launches, proposals and deletions */
  cancelOperation: operationSummaryShape,
  /** `{ sandbox }`, newest first */
  listOperations: z.object({ operations: z.array(operationSummaryShape) }),
  /** `{ sandbox, collection }`: runs every operation of the collection before it answers */
  runCollection: z.object({
    sandbox: z.string(),
    passed: z.number(),
    failed: z.number(),
    results: z.array(collectionResultShape),
  }),
  /** `{ sandbox }`: fails when the sandbox has no committed changes or already has a proposal */
  createProposal: z.object({ ok: z.boolean() }),
  /** `{ sandbox, subgraph }`: replaces an open portal of the same subgraph */
  openPortal: z.object({
    portal: portalShape,
    credential: z.string(),
    tunnelPath: z.string(),
    connectCommand: z.string(),
    dashboardUrl: z.string(),
  }),
  /** `{ sandbox, subgraph }` */
  closePortal: z.object({ portal: portalShape }),
  /** `{ sandbox }`, open portals first */
  listPortals: z.object({ portals: z.array(portalShape) }),
  /** `{}` */
  describeCurrentAccess: z.object({ organizationSlug: z.string() }),
};

/** The JSON answer of `POST /ci/schema-push`, which CI calls with `{ sandboxYaml, subgraphs, sha }`. */
export const schemaPushResult = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('sandbox'),
    sandboxName: z.string(),
    endpointUrl: z.string(),
    hubUrl: z.string(),
    passed: z.number(),
    failed: z.number(),
  }),
  z.object({ target: z.literal('schema'), graphSlug: z.string() }),
]);

/** Hub's web app pages for the sandbox `<schema>/<sandbox>` of an organization. */
export const hubPages = (hubAppUrl: string, organizationSlug: string, address: string) => {
  const organization = `${hubAppUrl.replace(/\/+$/, '')}/${encodeURIComponent(organizationSlug)}`;
  const [schema, name = ''] = address.split('/');
  const graph = `${organization}/graph/${encodeURIComponent(schema)}`;

  return {
    sandbox: `${graph}?view=${encodeURIComponent(name)}`,
    proposal: `${graph}?tab=proposal&view=${encodeURIComponent(name)}`,
    operation: (operationId: string) => `${organization}/operations/${encodeURIComponent(operationId)}`,
  };
};
