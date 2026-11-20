import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createInterrupt, FakeHub, linkedRepo, runWgc, sandboxDetails, startFakeHub, tempRepo } from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

describe('wgc hub sandbox list', () => {
  test('lists the sandboxes of the graph in sandbox.yaml', async () => {
    hub = await startFakeHub({
      tools: {
        list_sandboxes: () => ({
          structuredContent: {
            sandboxes: [
              sandboxDetails(),
              {
                ...sandboxDetails({ sandbox_id: 'sb_8e20', name: 'shop-agent', status: 'starting' }),
                graphql_url: null,
              },
            ],
          },
        }),
      },
    });
    const dir = await tempRepo({ 'sandbox.yaml': 'schema: shop\nsubgraphs:\n  - name: a\n    schema: a.graphql\n' });

    const run = await runWgc(['hub', 'sandbox', 'list'], { hubUrl: hub.url, cwd: dir, output: 'text' });

    expect(hub.toolCalls()).toEqual([{ name: 'list_sandboxes', arguments: { graph: 'shop' } }]);
    expect(run.stdout).toBe(
      [
        'shop-nithin (sb_3fd1)   running   https://sb-3fd1.sandbox.wundergraph.dev/graphql',
        'shop-agent (sb_8e20)   starting',
        '',
      ].join('\n'),
    );
  });

  test('without --schema or sandbox.yaml exits 2 with the fix', async () => {
    const run = await runWgc(['hub', 'sandbox', 'list', '--json'], { cwd: await tempRepo({}) });

    expect(run.exitCode).toBe(2);
    expect(run.json()).toMatchObject({
      ok: false,
      error: { remediation: 'Pass `--schema <slug>`, or run `wgc hub init` to create sandbox.yaml.' },
    });
  });
});

describe('wgc hub sandbox history', () => {
  test('lists every change with its age, surface and author', async () => {
    hub = await startFakeHub({
      tools: {
        list_sandbox_history: () => ({
          structuredContent: {
            entries: [
              {
                version: 'v14',
                summary: '+ source payments',
                surface: 'cli',
                actor: 'nithin',
                at: '2026-11-20T11:58:00Z',
              },
              {
                version: 'v13',
                summary: 'router 0.214.0',
                surface: 'mcp',
                actor: 'claude',
                at: '2026-11-20T09:00:00Z',
              },
            ],
          },
        }),
      },
    });

    const run = await runWgc(['hub', 'sandbox', 'history'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.stdout).toBe(
      ['v14  2m ago  cli  nithin  + source payments', 'v13  3h ago  mcp  claude  router 0.214.0', ''].join('\n'),
    );
  });
});

const line = (message: string) => ({ at: '2026-11-20T11:59:00Z', component: 'router', message });

describe('wgc hub sandbox logs', () => {
  test('prints the lines of one component since a duration', async () => {
    hub = await startFakeHub({
      tools: { get_sandbox_logs: () => ({ structuredContent: { lines: [line('started')], next_cursor: 'c1' } }) },
    });

    const run = await runWgc(['hub', 'sandbox', 'logs', '--since', '10m', '--router'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(hub.toolCalls()).toEqual([
      { name: 'get_sandbox_logs', arguments: { sandbox_id: 'sb_3fd1', since: '10m', component: 'router' } },
    ]);
    expect(run.stdout).toBe('2026-11-20T11:59:00Z  router  started\n');
  });

  test('--follow streams JSON lines with the cursor until Ctrl-C', async () => {
    const interrupt = createInterrupt();
    let calls = 0;
    hub = await startFakeHub({
      tools: {
        get_sandbox_logs: () => {
          calls++;
          if (calls === 3) {
            interrupt.press();
          }
          return { structuredContent: { lines: [line(`line ${calls}`)], next_cursor: `c${calls}` } };
        },
      },
    });

    const run = await runWgc(['hub', 'sandbox', 'logs', '--follow'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      interrupt,
    });

    expect(run.exitCode).toBe(0);
    expect(
      run.stdout
        .trim()
        .split('\n')
        .map((text) => JSON.parse(text).message),
    ).toEqual(['line 1', 'line 2']);
    expect(hub.toolCalls().map((call) => call.arguments)).toEqual([
      { sandbox_id: 'sb_3fd1', wait_seconds: 30 },
      { sandbox_id: 'sb_3fd1', wait_seconds: 30, cursor: 'c1' },
      { sandbox_id: 'sb_3fd1', wait_seconds: 30, cursor: 'c2' },
    ]);
  });
});

const proposalTool = (created: boolean) => ({
  create_proposal: () => ({
    structuredContent: {
      proposal: { number: 42, url: 'https://hub.wundergraph.com/acme/graph/shop/proposals/42' },
      created,
      changes: { total: 2, breaking: 0 },
    },
  }),
});

describe('wgc hub propose', () => {
  test('creates a proposal from the linked sandbox', async () => {
    hub = await startFakeHub({ tools: proposalTool(true) });
    const dir = await linkedRepo({ 'proposal.md': 'Adds payments.' });

    const run = await runWgc(['hub', 'propose', '--title', 'Add payments subgraph', '--body-file', 'proposal.md'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      'Created proposal #42 from sandbox sb_3fd1 (2 schema changes, 0 breaking)\n' +
        'https://hub.wundergraph.com/acme/graph/shop/proposals/42\n',
    );
    expect(hub.toolCalls()).toEqual([
      {
        name: 'create_proposal',
        arguments: {
          sandbox_id: 'sb_3fd1',
          idempotency_key: 'generated-key',
          title: 'Add payments subgraph',
          body: 'Adds payments.',
        },
      },
    ]);
  });

  test('an already open proposal is reported as no change', async () => {
    hub = await startFakeHub({ tools: proposalTool(false) });

    const run = await runWgc(['hub', 'propose', '--json'], { hubUrl: hub.url, cwd: await linkedRepo() });

    expect(run.json()).toMatchObject({ ok: true, changed: false, data: { proposal: { number: 42 } } });
  });

  test('a missing body file is a usage error', async () => {
    const dir = await linkedRepo();

    const run = await runWgc(['hub', 'propose', '--body-file', 'nope.md', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.json()).toMatchObject({ error: { message: `No file at ${path.join(dir, 'nope.md')}.` } });
  });
});
