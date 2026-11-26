import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer, IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import { createCredentials, createPluginContext } from '@wundergraph/wgc-plugin-sdk';
import type {
  AfterHook,
  CallerKind,
  CommandHooks,
  HookableCommand,
  OutputOverride,
  Prompts,
} from '@wundergraph/wgc-plugin-sdk';
import { createHubPlugin } from '../src/index.js';
import type { HubRuntime } from '../src/common/runtime.js';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface HubRequest {
  path: string;
  authorization: string | undefined;
  body: { [key: string]: Json };
}

export interface FakeHub {
  url: string;
  requests: HubRequest[];
  toolCalls(): Array<{ name: string; arguments: Json }>;
  close(): Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

type ToolOutcome = { structuredContent?: Json; isError?: boolean; text?: string };

/** Hub's own output schema of every tool the commands call, copied from Hub's tests/fixtures/wgc-hub-answers.json. */
const hubAnswers: Record<string, z.core.JSONSchema.JSONSchema> = JSON.parse(
  readFileSync(new URL('../contract/answers.json', import.meta.url), 'utf8'),
);

/** Refuses a successful answer Hub could not give, so a test cannot pass on an answer that went stale. */
const asHubAnswers = (tool: string, outcome: ToolOutcome): ToolOutcome => {
  if (outcome.isError || outcome.structuredContent === undefined) {
    return outcome;
  }

  const answer = z.fromJSONSchema(hubAnswers[tool]).safeParse(outcome.structuredContent);
  return answer.success
    ? outcome
    : { isError: true, text: `The test's ${tool} answer is not one Hub gives:\n${z.prettifyError(answer.error)}` };
};

/** Speaks MCP JSON-RPC on `/mcp`, answers `ci` on its `/ci/*` paths and plays GitHub's OIDC token endpoint on `/oidc`. */
export const startFakeHub = async ({
  tools = {},
  ci = {},
}: {
  tools?: Record<string, (args: { [key: string]: Json }) => ToolOutcome>;
  /** Status and body per `/ci/*` path, e.g. `{ '/ci/subgraph-check': { status: 200, body: { pullRequest: null } } }`. */
  ci?: Record<string, { status: number; body: Json }>;
}): Promise<FakeHub> => {
  const requests: HubRequest[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/oidc') {
      requests.push({
        path: `/oidc?audience=${url.searchParams.get('audience')}`,
        authorization: request.headers.authorization,
        body: {},
      });
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ value: 'github-oidc-token' }));
      return;
    }

    const body = JSON.parse(await readBody(request));
    requests.push({ path: url.pathname, authorization: request.headers.authorization, body });

    const ciAnswer = ci[url.pathname];
    if (ciAnswer) {
      response.writeHead(ciAnswer.status, { 'content-type': 'application/json' }).end(JSON.stringify(ciAnswer.body));
      return;
    }
    if (body.method === 'initialize') {
      response
        .writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }));
      return;
    }
    if (body.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }
    const tool = tools[body.params.name];
    const outcome = asHubAnswers(
      body.params.name,
      tool ? tool(body.params.arguments) : { isError: true, text: `Unknown tool ${body.params.name}` },
    );
    const result = {
      content: outcome.text ? [{ type: 'text', text: outcome.text }] : [],
      structuredContent: outcome.structuredContent,
      isError: outcome.isError,
    };
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    toolCalls: () =>
      requests
        .filter((request) => request.body.method === 'tools/call')
        .map((request) => {
          const params = request.body.params as { name: string; arguments: Json };
          return { name: params.name, arguments: params.arguments };
        }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
};

export const answeringPrompts = (answers: string[]): Prompts & { asked: string[] } => {
  const asked: string[] = [];
  return {
    canPrompt: true,
    asked,
    confirm: (question, defaultAnswer) => {
      asked.push(question);
      return Promise.resolve(defaultAnswer);
    },
    text: (question) => {
      asked.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
  };
};

export interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** stdout parsed as the single JSON result line. */
  json(): { [key: string]: Json };
  /** NDJSON progress events from stderr as `step subject: message`. */
  progress(): string[];
}

/** The clock every hub test runs at. */
export const testNow = new Date('2026-11-20T12:00:00Z');

/** Ctrl-C for a test: `press()` interrupts whatever the command is following. */
export const createInterrupt = () => {
  const listeners = new Set<() => void>();
  return {
    press: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    onInterrupt: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const runWgc = async (
  args: string[],
  {
    hubUrl = 'http://127.0.0.1:1',
    hubAppUrl = 'http://hub-app.invalid',
    wgcInstallArgs = 'wgc@latest',
    command = 'wgc',
    caller = 'agent',
    env = {},
    loginToken = 'login-token',
    prompts,
    cwd = process.cwd(),
    output,
    interrupt = createInterrupt(),
    openSocket = () => {
      throw new Error('this test opens no portal tunnel');
    },
  }: {
    hubUrl?: string;
    hubAppUrl?: string;
    wgcInstallArgs?: string;
    command?: string;
    caller?: CallerKind;
    env?: NodeJS.ProcessEnv;
    loginToken?: string;
    prompts?: Prompts;
    cwd?: string;
    output?: OutputOverride;
    interrupt?: ReturnType<typeof createInterrupt>;
    openSocket?: HubRuntime['openSocket'];
  } = {},
): Promise<Run> => {
  let stdout = '';
  let stderr = '';
  const context = createPluginContext({
    cliVersion: '0.0.0-test',
    command,
    homeDir: '/nonexistent/.wgc',
    caller,
    endpoints: {
      cosmoApiUrl: 'http://cosmo.invalid',
      cosmoWebUrl: 'http://cosmo.invalid',
      hubUrl,
      hubAppUrl,
      wgcInstallArgs,
    },
    credentials: createCredentials({
      env,
      login: () => Promise.resolve(loginToken === '' ? undefined : { token: loginToken, organizationSlug: 'acme' }),
    }),
    outputOverride: output,
    prompts,
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });

  const runtime: HubRuntime = {
    cwd: () => cwd,
    env,
    now: () => testNow,
    sleep: () => Promise.resolve(),
    onInterrupt: interrupt.onInterrupt,
    newIdempotencyKey: () => 'generated-key',
    openSocket,
  };
  const hubPlugin = createHubPlugin(runtime);
  const program = new Command('wgc').exitOverride();
  const hub = program.command(hubPlugin.name).description(hubPlugin.description);
  hubPlugin.register?.(hub, context);

  process.exitCode = 0;
  await program.parseAsync(['node', 'wgc', ...args]);
  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = 0;

  return {
    stdout,
    stderr,
    exitCode,
    json: () => JSON.parse(stdout.trim()),
    progress: () =>
      stderr
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => {
          const event = JSON.parse(line) as { step: string; subject?: string; message: string };
          return `${event.step} ${event.subject ?? ''}: ${event.message}`;
        }),
  };
};

export const tempRepo = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wgc-hub-'));
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true });
    await writeFile(path.join(dir, relativePath), content);
  }
  return dir;
};

type StepJson = { label: string; status: string; detail: string };

export const step = (label: string, status: string, detail = '') => ({ label, status, detail }) satisfies StepJson;

export const sandboxAddress = 'shop/shop-nithin';

export const operationUrl = (id: string) => `https://hub.wundergraph.com/acme/operations/${id}`;

/** An operation as Hub's `list_operations` and `cancel_operation` return it. */
export const operationSummary = ({
  id = 'op_7Kq2',
  kind = 'launch_sandbox',
  status = 'running',
  origin = 'cli',
}: {
  id?: string;
  kind?: string;
  status?: string;
  origin?: string;
}) => ({
  operationId: id,
  kind,
  status,
  title: `${kind} ${sandboxAddress}`,
  origin,
  sandbox: sandboxAddress,
  requestedBy: 'user-1',
  agentName: null,
  createdAt: '2026-11-20T11:56:00Z',
  finishedAt: status === 'succeeded' || status === 'failed' ? '2026-11-20T11:56:30Z' : null,
  dashboardUrl: operationUrl(id),
});

/** An operation as Hub's `get_operation` returns it. */
export const hubOperation = ({
  steps = [],
  error = null,
  approval = null,
  ...summary
}: {
  id?: string;
  kind?: string;
  status?: string;
  steps?: StepJson[];
  error?: { code: string; message: string; remediation: string | null } | null;
  approval?: { reason: string; approvalPermission: string | null; decidedBy: null; decidedAt: null } | null;
}) => ({
  ...operationSummary(summary),
  steps,
  result: null,
  error: error === null ? null : { ...error, failureKind: null, failureReason: null },
  approval,
});

/** Answers each call with the next item, repeating the last one. */
export const sequence = <T>(items: T[]) => {
  let index = 0;
  return () => {
    const item = items[Math.min(index, items.length - 1)];
    index++;
    return item;
  };
};

/** A sandbox as Hub's `get_sandbox` returns it to a token that grants "run". */
export const hubSandbox = (address = sandboxAddress) => ({
  address,
  endpointUrl: 'https://sb-3fd1.sandbox.wundergraph.dev/graphql',
  endpointToken: 'endpoint-secret',
  routerStatus: 'live',
  viewSeq: 14,
  source: { kind: 'schema', name: 'shop', deleted: false },
  sharing: 'private',
  openPortals: 0,
  proposalOutcome: null,
});

export const linkedRepo = (files: Record<string, string> = {}) =>
  tempRepo({ '.wgc/link.json': JSON.stringify({ sandbox: sandboxAddress }), ...files });

const noop = () => {};
const ignoreInterrupt: HubRuntime['onInterrupt'] = () => noop;

/** The hub plugin's `after` hooks, registered the way wgc registers them, for a CI job (or not) talking to `hubUrl`. */
export const hubHooks = ({ hubUrl, env }: { hubUrl: string; env: NodeJS.ProcessEnv }) => {
  const after: { [N in HookableCommand]: AfterHook<N>[] } = {
    'subgraph check': [],
    'subgraph publish': [],
    'subgraph create': [],
    'subgraph delete': [],
    'federated-graph create': [],
    'federated-graph delete': [],
  };
  const hooks: CommandHooks = {
    before: () => {},
    after: (command, hook) => {
      after[command].push(hook);
    },
  };
  const context = createPluginContext({
    cliVersion: '0.0.0-test',
    command: 'wgcm',
    homeDir: '/nonexistent/.wgc',
    caller: 'agent',
    endpoints: {
      cosmoApiUrl: 'http://cosmo.invalid',
      cosmoWebUrl: 'http://cosmo.invalid',
      hubUrl,
      hubAppUrl: 'http://hub-app.invalid',
      wgcInstallArgs: 'wgc@latest',
    },
    credentials: createCredentials({
      env,
      login: () => Promise.resolve({ token: 'login-token', organizationSlug: 'acme' }),
    }),
  });
  const runtime: HubRuntime = {
    cwd: () => process.cwd(),
    env,
    now: () => testNow,
    sleep: () => Promise.resolve(),
    onInterrupt: ignoreInterrupt,
    newIdempotencyKey: () => 'generated-key',
    openSocket: () => {
      throw new Error('hooks open no portal tunnel');
    },
  };
  createHubPlugin(runtime).hooks?.(hooks, context);
  return { after, context };
};

/** The env of a GitHub Actions job whose OIDC token endpoint is the fake Hub's `/oidc`. */
export const githubActionsEnv = (hubUrl: string): NodeJS.ProcessEnv => ({
  GITHUB_ACTIONS: 'true',
  ACTIONS_ID_TOKEN_REQUEST_URL: `${hubUrl}/oidc`,
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
});
