import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createInterrupt,
  FakeHub,
  hubOperation,
  operationUrl,
  runWgc,
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
  step('Copy schema shop', statuses[0]),
  step('Compose supergraph', statuses[1]),
  step('Start router 0.214.0', statuses[2]),
];

const allSucceeded = ['succeeded', 'succeeded', 'succeeded'];

/** What Hub's `launch_sandbox` answers for `shop/<name>`. */
const launched = (name = 'shop-nithin') => ({
  address: `shop/${name}`,
  schema: 'shop',
  name,
  source: { kind: 'schema', name: 'shop', deleted: false },
  routerStatus: 'starting',
  endpointUrl: 'https://sb-3fd1.sandbox.wundergraph.dev/graphql',
  sharing: 'private',
  openPortals: 0,
  proposalOutcome: null,
  url: `https://hub.wundergraph.com/acme/graph/shop?view=${name}`,
  operationId: 'op_7Kq2',
  status: 'queued',
  dashboardUrl: operationUrl('op_7Kq2'),
});

const launchTools = (finalOperation: ReturnType<typeof hubOperation>, name?: string) => ({
  launch_sandbox: () => ({ structuredContent: launched(name) }),
  get_operation: sequence([
    { structuredContent: hubOperation({ steps: launchSteps(['succeeded', 'running', 'running']) }) },
    { structuredContent: finalOperation },
  ]),
});

describe('wgc hub sandbox launch', () => {
  test('prints the operation URL first, streams the steps, links the directory and points to the next command', async () => {
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
        `  ${operationUrl('op_7Kq2')}`,
        '',
        '  ✓ Copy schema shop',
        '  ✓ Compose supergraph',
        '  ✓ Start router 0.214.0',
        '',
        '',
      ].join('\n'),
    );
    expect(run.stdout).toBe(
      [
        'Sandbox ready  https://sb-3fd1.sandbox.wundergraph.dev/graphql',
        'Linked this directory to shop/shop-nithin (.wgc/link.json, added to .gitignore)',
        '',
        'Next',
        '  wgc hub open      open the sandbox in Hub',
        '',
      ].join('\n'),
    );
    expect(JSON.parse(await readFile(path.join(dir, '.wgc', 'link.json'), 'utf8'))).toEqual({
      sandbox: 'shop/shop-nithin',
    });
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('.wgc/\n');
    expect(hub.toolCalls()).toEqual([
      { name: 'launch_sandbox', arguments: { from: 'shop', name: 'shop-nithin', idempotency_key: 'generated-key' } },
      { name: 'get_operation', arguments: { operationId: 'op_7Kq2' } },
      { name: 'get_operation', arguments: { operationId: 'op_7Kq2' } },
    ]);
  });

  test('JSON callers get one envelope on stdout and only NDJSON events on stderr; --from copies a sandbox', async () => {
    hub = await startFakeHub({
      tools: launchTools(hubOperation({ status: 'succeeded', steps: launchSteps(allSucceeded) }), 'shop-agent'),
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml, '.gitignore': 'node_modules\n' });

    const run = await runWgc(
      ['hub', 'sandbox', 'launch', '--name', 'shop-agent', '--from', 'shop-nithin', '--idempotency-key', 'k-1'],
      { hubUrl: hub.url, cwd: dir },
    );

    expect(run.exitCode).toBe(0);
    expect(
      run.stderr
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).event),
    ).toEqual(['operation', 'step', 'step', 'step']);
    expect(run.json()).toMatchObject({
      ok: true,
      operation: { id: 'op_7Kq2', status: 'succeeded' },
      data: {
        sandbox: { address: 'shop/shop-agent', endpointUrl: 'https://sb-3fd1.sandbox.wundergraph.dev/graphql' },
        link: { path: '.wgc/link.json', changed: true, gitignoreUpdated: true },
      },
      url: operationUrl('op_7Kq2'),
      next: ['wgc hub open'],
    });
    expect(hub.toolCalls()[0].arguments).toEqual({
      from: 'shop/shop-nithin',
      name: 'shop-agent',
      idempotency_key: 'k-1',
    });
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
    expect(hub.toolCalls()[0]).toEqual({ name: 'export_sandbox_config', arguments: { sandbox: 'shop' } });
  });

  test('a failed step prints the error block with its remediation, and exits 1', async () => {
    hub = await startFakeHub({
      tools: {
        launch_sandbox: () => ({ structuredContent: launched() }),
        get_operation: () => ({
          structuredContent: hubOperation({
            status: 'failed',
            steps: [step('Copy schema shop', 'succeeded'), step('Start router 0.214.0', 'failed', 'exited with 1')],
            error: {
              code: 'SANDBOX_RUNTIME_FAILED',
              message: 'The router of shop/shop-nithin did not start.',
              remediation: 'Read its logs with `wgc hub sandbox logs --source router`.',
            },
          }),
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
      '  ✓ Copy schema shop',
      '  ✗ Start router 0.214.0 exited with 1',
      '',
      'error SANDBOX_RUNTIME_FAILED',
      '  The router of shop/shop-nithin did not start.',
      '  Read its logs with `wgc hub sandbox logs --source router`.',
      '',
    ]);
  });

  test('Ctrl-C detaches with exit 130 and leaves the operation running in Hub', async () => {
    const interrupt = createInterrupt();
    hub = await startFakeHub({
      tools: {
        launch_sandbox: () => ({ structuredContent: launched() }),
        get_operation: () => {
          interrupt.press();
          return { structuredContent: hubOperation({ steps: launchSteps(['running', 'running', 'running']) }) };
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
    expect(hub.toolCalls().map((call) => call.name)).toEqual(['launch_sandbox', 'get_operation', 'get_operation']);
    expect(JSON.parse(await readFile(path.join(dir, '.wgc', 'link.json'), 'utf8'))).toEqual({
      sandbox: 'shop/shop-nithin',
    });
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
        `  ${operationUrl('op_7Kq2')}`,
        'Watch   wgc hub operation watch op_7Kq2',
        'Linked this directory to shop/shop-nithin (.wgc/link.json, added to .gitignore)',
        '',
      ].join('\n'),
    );
    expect(hub.toolCalls().map((call) => call.name)).toEqual(['launch_sandbox']);
  });

  test('an operation waiting for approval exits 5 with the Hub page to approve it on', async () => {
    hub = await startFakeHub({
      tools: launchTools(
        hubOperation({
          status: 'needs_approval',
          approval: {
            reason: 'Allowing a wildcard host lets sandbox code reach any matching host.',
            approvalPermission: 'manage_egress',
            decidedBy: null,
            decidedAt: null,
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
        remediation: `Approve it in Hub:\n${operationUrl('op_7Kq2')}`,
        next: ['wgc hub operation watch op_7Kq2'],
      },
      url: operationUrl('op_7Kq2'),
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
