import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { FakeHub, linkedRepo, runWgc, sandboxDetails, startFakeHub, tempRepo } from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const describeTool = () => ({ describe_sandbox: () => ({ structuredContent: { sandbox: sandboxDetails() } }) });

describe('wgc hub link', () => {
  test('writes .wgc/link.json next to sandbox.yaml and gitignores it; linking again changes nothing', async () => {
    hub = await startFakeHub({ tools: describeTool() });
    const dir = await tempRepo({ 'sandbox.yaml': 'schema: shop\n', 'api/.keep': '' });
    const cwd = path.join(dir, 'api');

    const first = await runWgc(['hub', 'link', 'sb_3fd1'], { hubUrl: hub.url, cwd, output: 'text' });
    const second = await runWgc(['hub', 'link', 'sb_3fd1', '--json'], { hubUrl: hub.url, cwd });

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe('Linked this directory to sb_3fd1 (.wgc/link.json, added to .gitignore)\n');
    expect(JSON.parse(await readFile(path.join(dir, '.wgc', 'link.json'), 'utf8'))).toEqual({
      orgSlug: 'acme',
      graphSlug: 'shop',
      sandboxId: 'sb_3fd1',
    });
    expect(second.json()).toEqual({
      ok: true,
      changed: false,
      data: {
        sandbox: { sandboxId: 'sb_3fd1', name: 'shop-nithin' },
        link: { path: '.wgc/link.json', changed: false, gitignoreUpdated: false },
      },
      url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1',
    });
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('.wgc/\n');
  });

  test('without a sandbox exits 2 and names the command to pass', async () => {
    const run = await runWgc(['hub', 'link', '--no-input', '--json'], { cwd: await tempRepo({}) });

    expect(run.exitCode).toBe(2);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'USAGE_ERROR',
        message: 'Name the sandbox to link this directory to.',
        remediation: 'Run `wgc hub link <sandbox>`; `wgc hub sandbox list` shows the sandboxes.',
        next: ['wgc hub sandbox list'],
      },
    });
  });

  test('unlink removes the link, and reports no change when there is none', async () => {
    const dir = await linkedRepo();

    const first = await runWgc(['hub', 'unlink', '--json'], { cwd: dir });
    const second = await runWgc(['hub', 'unlink', '--json'], { cwd: dir });

    expect(existsSync(path.join(dir, '.wgc', 'link.json'))).toBe(false);
    expect([first.json().changed, second.json().changed]).toEqual([true, false]);
  });
});

describe('wgc hub status', () => {
  test('renders the linked sandbox like the dashboard header', async () => {
    hub = await startFakeHub({ tools: describeTool() });

    const run = await runWgc(['hub', 'status'], { hubUrl: hub.url, cwd: await linkedRepo(), output: 'text' });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        'Sandbox     shop-nithin (sb_3fd1)   running',
        'Graph       acme/shop',
        'Router      0.214.0   (latest 0.216.1, run `wgc forge router upgrade`)',
        'Sources     accounts ✓  catalog ✓  orders ✓',
        'Last op     forge.check  succeeded 4m ago   op_6Pd0',
        'URL         https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1',
        '',
      ].join('\n'),
    );
    expect(hub.toolCalls()).toEqual([{ name: 'describe_sandbox', arguments: { sandbox_id: 'sb_3fd1' } }]);
  });

  test('--sandbox wins over WGC_SANDBOX, which wins over the link', async () => {
    hub = await startFakeHub({ tools: describeTool() });
    const dir = await linkedRepo();

    await runWgc(['hub', 'status', '--sandbox', 'sb_flag'], {
      hubUrl: hub.url,
      cwd: dir,
      env: { WGC_SANDBOX: 'sb_env' },
    });
    await runWgc(['hub', 'status'], { hubUrl: hub.url, cwd: dir, env: { WGC_SANDBOX: 'sb_env' } });
    await runWgc(['hub', 'status'], { hubUrl: hub.url, cwd: dir });

    expect(hub.toolCalls().map((call) => call.arguments)).toEqual([
      { sandbox_id: 'sb_flag' },
      { sandbox_id: 'sb_env' },
      { sandbox_id: 'sb_3fd1' },
    ]);
  });

  test('an unlinked directory exits 2 with the ways to pick a sandbox', async () => {
    const dir = await tempRepo({});

    const run = await runWgc(['hub', 'status'], { cwd: dir, output: 'text' });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toBe(
      `error: No sandbox is linked to ${dir}.\n` +
        'Pass --sandbox <id>, set WGC_SANDBOX, or link this directory with `wgc hub link <sandbox>`.\n',
    );
  });
});

describe('wgc hub open', () => {
  test('prints the page URL from the link without calling Hub when the caller is not a person', async () => {
    const dir = await linkedRepo();

    const sandbox = await runWgc(['hub', 'open'], { cwd: dir, output: 'text', hubUrl: 'https://hub.wundergraph.com' });
    const operation = await runWgc(['hub', 'open', 'operation', 'op_7Kq2', '--json'], {
      cwd: dir,
      hubUrl: 'https://hub.wundergraph.com',
    });
    const proposal = await runWgc(['hub', 'open', 'proposal', '42', '--print'], {
      cwd: dir,
      output: 'text',
      hubUrl: 'https://hub.wundergraph.com',
    });

    expect(sandbox.stdout).toBe('https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1\n');
    expect(operation.json()).toEqual({
      ok: true,
      data: {
        url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
        opened: false,
      },
      url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
    });
    expect(proposal.stdout).toBe('https://hub.wundergraph.com/acme/graph/shop/proposals/42\n');
  });

  test('asks Hub for the org and graph of a sandbox picked with --sandbox', async () => {
    hub = await startFakeHub({ tools: describeTool() });

    const run = await runWgc(['hub', 'open', 'history', '--sandbox', 'shop-nithin'], {
      hubUrl: hub.url,
      cwd: await tempRepo({}),
      output: 'text',
    });

    expect(run.stdout).toBe(`${hub.url}/acme/graph/shop/sandboxes/sb_3fd1/history\n`);
    expect(hub.toolCalls()).toEqual([{ name: 'describe_sandbox', arguments: { sandbox_id: 'shop-nithin' } }]);
  });

  test('an operation without its id is a usage error', async () => {
    const run = await runWgc(['hub', 'open', 'operation'], { cwd: await linkedRepo() });

    expect(run.exitCode).toBe(2);
  });
});
