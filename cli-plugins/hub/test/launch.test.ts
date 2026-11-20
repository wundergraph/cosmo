import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createInterrupt,
  FakeHub,
  hubOperation,
  runWgc,
  sandboxDetails,
  sequence,
  startFakeHub,
  step,
  tempRepo,
} from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const sandboxYaml = `schema: shop
subgraphs:
  - name: accounts
    schema: accounts.graphql
`;

const launchSteps = (statuses: string[]) => [
  step('Validate sandbox.yaml', statuses[0], 200),
  step('Fetch sources (accounts, catalog, orders)', statuses[1], 1900),
  step('Compose supergraph', statuses[2], 700),
  step('Start router 0.214.0', statuses[3], 4100),
  step('Load mock fixtures (12)', statuses[4], 300),
];

const pending = ['pending', 'pending', 'pending', 'pending', 'pending'];

const allSucceeded = ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'];

const launchedSandbox = {
  sandbox_id: 'sb_3fd1',
  name: 'shop-nithin',
  status: 'starting',
  org_slug: 'acme',
  graph_slug: 'shop',
  url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1',
  graphql_url: null,
};

const launchTools = (finalOperation: ReturnType<typeof hubOperation>) => ({
  launch_sandbox: () => ({
    structuredContent: { sandbox: launchedSandbox, operation: hubOperation({ steps: launchSteps(pending) }) },
  }),
  get_operation: sequence([
    {
      structuredContent: {
        operation: hubOperation({
          steps: launchSteps(['succeeded', 'succeeded', 'running', 'pending', 'pending']),
        }),
      },
    },
    { structuredContent: { operation: finalOperation } },
  ]),
  describe_sandbox: () => ({ structuredContent: { sandbox: sandboxDetails() } }),
});

describe('wgc hub sandbox launch', () => {
  test('prints the operation URL first, streams the steps, links the directory and points to the next commands', async () => {
    hub = await startFakeHub({
      tools: launchTools(hubOperation({ status: 'succeeded', steps: launchSteps(allSucceeded) })),
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml, 'services/accounts/.keep': '' });

    const run = await runWgc(['hub', 'sandbox', 'launch'], {
      hubUrl: hub.url,
      cwd: path.join(dir, 'services', 'accounts'),
      env: { USER: 'nithin' },
      output: 'text',
    });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe(
      [
        'Launching sandbox "shop-nithin"',
        '  https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
        '',
        '  ✓ Validate sandbox.yaml                     0.2s',
        '  ✓ Fetch sources (accounts, catalog, orders) 1.9s',
        '  ✓ Compose supergraph                        0.7s',
        '  ✓ Start router 0.214.0                      4.1s',
        '  ✓ Load mock fixtures (12)                   0.3s',
        '',
        '',
      ].join('\n'),
    );
    expect(run.stdout).toBe(
      [
        'Sandbox ready  https://sb-3fd1.sandbox.wundergraph.dev/graphql',
        'Linked this directory to sb_3fd1 (.wgc/link.json, added to .gitignore)',
        '',
        'Next',
        '  wgc hub collection run smoke      run your saved operations',
        '  wgc hub open                      open the sandbox in Hub',
        '',
      ].join('\n'),
    );
    expect(JSON.parse(await readFile(path.join(dir, '.wgc', 'link.json'), 'utf8'))).toEqual({
      orgSlug: 'acme',
      graphSlug: 'shop',
      sandboxId: 'sb_3fd1',
    });
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('.wgc/\n');
    expect(hub.toolCalls()[0]).toEqual({
      name: 'launch_sandbox',
      arguments: { graph: 'shop', name: 'shop-nithin', sandbox_yaml: sandboxYaml, idempotency_key: 'generated-key' },
    });
  });

  test('JSON callers get one envelope on stdout and only NDJSON events on stderr', async () => {
    hub = await startFakeHub({
      tools: launchTools(hubOperation({ status: 'succeeded', steps: launchSteps(allSucceeded) })),
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml, '.gitignore': 'node_modules\n' });

    const run = await runWgc(['hub', 'sandbox', 'launch', '--name', 'shop-agent', '--idempotency-key', 'k-1'], {
      hubUrl: hub.url,
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(
      run.stderr
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).event),
    ).toEqual(['operation', 'step', 'step', 'step', 'step', 'step']);
    expect(run.json()).toMatchObject({
      ok: true,
      operation: { id: 'op_7Kq2', status: 'succeeded' },
      data: {
        sandbox: { sandboxId: 'sb_3fd1', graphqlUrl: 'https://sb-3fd1.sandbox.wundergraph.dev/graphql' },
        link: { path: '.wgc/link.json', changed: true, gitignoreUpdated: true },
      },
      url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
      next: ['wgc hub collection run smoke', 'wgc hub open'],
    });
    expect(hub.toolCalls()[0].arguments).toMatchObject({ name: 'shop-agent', idempotency_key: 'k-1' });
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.wgc/\n');
  });

  test('without sandbox.yaml a non-interactive run exits 2 with the flag to pass', async () => {
    const dir = await tempRepo({});

    const run = await runWgc(['hub', 'sandbox', 'launch', '--no-input'], { cwd: dir, output: 'text' });

    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe(
      `error: sandbox.yaml not found in ${dir} or any parent directory.\n` +
        'Run `wgc hub sandbox launch --init-from-graph <graph>` to create one, or pass --config <path>.\n',
    );
  });

  test('--init-from-graph writes sandbox.yaml from the Hub graph before launching', async () => {
    hub = await startFakeHub({
      tools: {
        export_sandbox_config: () => ({
          structuredContent: {
            sandbox_yaml: sandboxYaml,
            router_version: '0.214.0',
            sources: ['accounts', 'catalog', 'orders'],
          },
        }),
        ...launchTools(hubOperation({ status: 'succeeded', steps: launchSteps(allSucceeded) })),
      },
    });
    const dir = await tempRepo({});

    const run = await runWgc(['hub', 'sandbox', 'launch', '--init-from-graph', 'shop', '--name', 'shop-nithin'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
    });

    expect(run.exitCode).toBe(0);
    expect(run.stderr.split('\n').slice(0, 3)).toEqual([
      'Created sandbox.yaml (router 0.214.0, 3 sources from graph shop)',
      '',
      'Launching sandbox "shop-nithin"',
    ]);
    expect(await readFile(path.join(dir, 'sandbox.yaml'), 'utf8')).toBe(sandboxYaml);
    expect(hub.toolCalls()[0]).toEqual({ name: 'export_sandbox_config', arguments: { graph: 'shop' } });
  });

  test('a failed step prints the error block with its fix and docs, and exits 1', async () => {
    hub = await startFakeHub({
      tools: {
        ...launchTools(hubOperation({})),
        get_operation: () => ({
          structuredContent: {
            operation: hubOperation({
              status: 'failed',
              steps: [step('Validate sandbox.yaml', 'succeeded', 100), step('Fetch source payments', 'failed', 10_000)],
              error: {
                code: 'FORGE_SOURCE_UNREACHABLE',
                message: 'Forge could not fetch https://payments.internal/graphql (timeout after 10s).',
                remediation: "payments.internal is not on this sandbox's egress allowlist.",
                cli: 'wgc hub sandbox egress allow payments.internal',
                docs_url: 'https://cosmo-docs.wundergraph.com/errors/FORGE_SOURCE_UNREACHABLE',
              },
            }),
          },
        }),
      },
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml });

    const run = await runWgc(['hub', 'sandbox', 'launch', '--name', 'shop-nithin'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
    });

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.split('\n').slice(3)).toEqual([
      '  ✓ Validate sandbox.yaml 0.1s',
      '  ✗ Fetch source payments 10.0s',
      '',
      'error FORGE_SOURCE_UNREACHABLE',
      '  Forge could not fetch https://payments.internal/graphql (timeout after 10s).',
      "  payments.internal is not on this sandbox's egress allowlist.",
      '',
      '  Fix   wgc hub sandbox egress allow payments.internal',
      '  Docs  https://cosmo-docs.wundergraph.com/errors/FORGE_SOURCE_UNREACHABLE',
      '',
    ]);
  });

  test('Ctrl-C detaches with exit 130 and leaves the operation running in Hub', async () => {
    const interrupt = createInterrupt();
    hub = await startFakeHub({
      tools: {
        launch_sandbox: () => ({
          structuredContent: { sandbox: launchedSandbox, operation: hubOperation({ steps: launchSteps(pending) }) },
        }),
        get_operation: () => {
          interrupt.press();
          return { structuredContent: { operation: hubOperation({ steps: launchSteps(pending) }) } };
        },
      },
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml });

    const run = await runWgc(['hub', 'sandbox', 'launch', '--name', 'shop-nithin'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
      interrupt,
    });

    expect(run.exitCode).toBe(130);
    expect(run.stdout).toBe(
      [
        'Detached from op_7Kq2. It keeps running in Hub.',
        'Watch   wgc hub operation watch op_7Kq2',
        'Cancel  wgc hub operation cancel op_7Kq2',
        '',
      ].join('\n'),
    );
    expect(hub.toolCalls().map((call) => call.name)).toEqual(['launch_sandbox', 'get_operation']);
    expect(JSON.parse(await readFile(path.join(dir, '.wgc', 'link.json'), 'utf8')).sandboxId).toBe('sb_3fd1');
  });

  test('--detach returns the operation at once and still links the directory', async () => {
    hub = await startFakeHub({ tools: launchTools(hubOperation({ status: 'succeeded' })) });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml });

    const run = await runWgc(['hub', 'sandbox', 'launch', '--name', 'shop-nithin', '--detach'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        'Started sandbox launch op_7Kq2',
        '  https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
        'Watch   wgc hub operation watch op_7Kq2',
        'Linked this directory to sb_3fd1 (.wgc/link.json, added to .gitignore)',
        '',
      ].join('\n'),
    );
    expect(hub.toolCalls().map((call) => call.name)).toEqual(['launch_sandbox']);
  });

  test('an operation waiting for approval exits 5 with the Hub page to approve it on', async () => {
    hub = await startFakeHub({
      tools: launchTools(
        hubOperation({
          status: 'input_required',
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Allowing a wildcard host lets sandbox code reach any matching host.',
            remediation: 'Approve it in Hub:',
          },
        }),
      ),
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml });

    const run = await runWgc(['hub', 'sandbox', 'launch', '--name', 'shop-nithin', '--json'], {
      hubUrl: hub.url,
      cwd: dir,
    });

    expect(run.exitCode).toBe(5);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Allowing a wildcard host lets sandbox code reach any matching host.',
        remediation:
          'Approve it in Hub:\nhttps://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
        next: ['wgc hub operation watch op_7Kq2'],
      },
      url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
    });
  });

  test('exits 4 with the login command when not signed in', async () => {
    hub = await startFakeHub({ tools: {} });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml });

    const run = await runWgc(['hub', 'sandbox', 'launch', '--name', 'x'], {
      hubUrl: hub.url,
      cwd: dir,
      loginToken: '',
      output: 'text',
    });

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toBe(
      [
        'Launching sandbox "x"',
        'error NOT_LOGGED_IN',
        '  Not signed in.',
        '  Run `wgc auth login` first.',
        '',
        '  Fix   wgc auth login',
        '',
      ].join('\n'),
    );
  });
});
