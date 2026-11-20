import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer, IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { createCredentials, createPluginContext } from '@wundergraph/wgc-plugin-sdk';
import type { CallerKind, OutputOverride, Prompts } from '@wundergraph/wgc-plugin-sdk';
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

/** Speaks MCP JSON-RPC on `/mcp`, `/ci/schema-push` and GitHub's OIDC token endpoint on `/oidc`. */
export const startFakeHub = async ({
  tools = {},
  schemaPush = {},
}: {
  tools?: Record<
    string,
    (args: { [key: string]: Json }) => { structuredContent?: Json; isError?: boolean; text?: string }
  >;
  schemaPush?: Json;
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

    if (url.pathname === '/ci/schema-push') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(schemaPush));
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
    const outcome = tool ? tool(body.params.arguments) : { isError: true, text: `Unknown tool ${body.params.name}` };
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
    caller = 'agent',
    env = {},
    loginToken = 'login-token',
    prompts,
    cwd = process.cwd(),
    output,
    interrupt = createInterrupt(),
  }: {
    hubUrl?: string;
    caller?: CallerKind;
    env?: NodeJS.ProcessEnv;
    loginToken?: string;
    prompts?: Prompts;
    cwd?: string;
    output?: OutputOverride;
    interrupt?: ReturnType<typeof createInterrupt>;
  } = {},
): Promise<Run> => {
  let stdout = '';
  let stderr = '';
  const context = createPluginContext({
    cliVersion: '0.0.0-test',
    caller,
    endpoints: { cosmoApiUrl: 'http://cosmo.invalid', cosmoWebUrl: 'http://cosmo.invalid', hubUrl },
    credentials: createCredentials({ env, loginToken: () => Promise.resolve(loginToken) }),
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
  };
  const hubPlugin = createHubPlugin(runtime);
  const program = new Command('wgc').exitOverride();
  const hub = program.command(hubPlugin.name).description(hubPlugin.description);
  hubPlugin.register(hub, context);

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

type StepJson = { name: string; status: string; duration_ms: number | null; detail: string | null };

export const step = (name: string, status: string, durationMs: number | null = null, detail: string | null = null) =>
  ({ name, status, duration_ms: durationMs, detail }) satisfies StepJson;

export const hubBase = 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1';

/** An operation as Hub's `get_operation` returns it. */
export const hubOperation = ({
  id = 'op_7Kq2',
  kind = 'sandbox.launch',
  status = 'running',
  steps = [],
  events = [],
  error = null,
}: {
  id?: string;
  kind?: string;
  status?: string;
  steps?: StepJson[];
  events?: Array<{ at: string; message: string; step: string | null }>;
  error?: { [key: string]: Json } | null;
}) => ({
  operation_id: id,
  kind,
  status,
  steps,
  events,
  url: `${hubBase}/operations/${id}`,
  origin: { surface: 'cli', client: 'wgc' },
  error,
  started_at: '2026-11-20T11:56:00Z',
  finished_at: status === 'succeeded' || status === 'failed' ? '2026-11-20T11:56:30Z' : null,
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

export const sandboxDetails = (overrides: { [key: string]: Json } = {}) => ({
  sandbox_id: 'sb_3fd1',
  name: 'shop-nithin',
  status: 'running',
  org_slug: 'acme',
  graph_slug: 'shop',
  url: hubBase,
  graphql_url: 'https://sb-3fd1.sandbox.wundergraph.dev/graphql',
  router_version: '0.214.0',
  latest_router_version: '0.216.1',
  sources: [
    { name: 'accounts', status: 'ok' },
    { name: 'catalog', status: 'ok' },
    { name: 'orders', status: 'ok' },
  ],
  collections: ['smoke'],
  last_operation: {
    operation_id: 'op_6Pd0',
    kind: 'forge.check',
    status: 'succeeded',
    finished_at: '2026-11-20T11:56:00Z',
  },
  ...overrides,
});

export const linkedRepo = (files: Record<string, string> = {}) =>
  tempRepo({
    '.wgc/link.json': JSON.stringify({ orgSlug: 'acme', graphSlug: 'shop', sandboxId: 'sb_3fd1' }),
    ...files,
  });
