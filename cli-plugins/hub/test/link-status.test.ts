import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { FakeHub, hubSandbox, linkedRepo, runWgc, startFakeHub, tempRepo } from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const getSandboxTool = () => ({ get_sandbox: () => ({ structuredContent: hubSandbox() }) });

describe('wgc hub link', () => {
  test('writes .wgc/link.json next to sandbox.yaml and gitignores it; linking again changes nothing', async () => {
    hub = await startFakeHub({ tools: getSandboxTool() });
    const dir = await tempRepo({ 'sandbox.yaml': 'schema: shop\n', 'api/.keep': '' });
    const cwd = path.join(dir, 'api');

    const first = await runWgc(['hub', 'link', 'shop/shop-nithin'], { hubUrl: hub.url, cwd, output: 'text' });
    const second = await runWgc(['hub', 'link', 'shop/shop-nithin', '--json'], { hubUrl: hub.url, cwd });

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe('Linked this directory to shop/shop-nithin (.wgc/link.json, added to .gitignore)\n');
    expect(JSON.parse(await readFile(path.join(dir, '.wgc', 'link.json'), 'utf8'))).toEqual({
      sandbox: 'shop/shop-nithin',
    });
    expect(second.json()).toEqual({
      ok: true,
      changed: false,
      data: {
        sandbox: 'shop/shop-nithin',
        link: { path: '.wgc/link.json', changed: false, gitignoreUpdated: false },
      },
    });
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('.wgc/\n');
    expect(hub.toolCalls()[0]).toEqual({ name: 'get_sandbox', arguments: { sandbox: 'shop/shop-nithin' } });
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

  test('a link file from before sandbox addresses asks to link again', async () => {
    const dir = await tempRepo({
      '.wgc/link.json': JSON.stringify({ orgSlug: 'acme', graphSlug: 'shop', sandboxId: 'sb_3fd1' }),
    });

    const run = await runWgc(['hub', 'status', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(run.json()).toMatchObject({ error: { remediation: 'Run `wgc hub link <sandbox>` to rewrite it.' } });
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
  test('renders the linked sandbox and never prints its endpoint token', async () => {
    hub = await startFakeHub({ tools: getSandboxTool() });
    const dir = await linkedRepo();

    const text = await runWgc(['hub', 'status'], { hubUrl: hub.url, cwd: dir, output: 'text' });
    const json = await runWgc(['hub', 'status', '--json'], { hubUrl: hub.url, cwd: dir });

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toBe(
      [
        'Sandbox     shop/shop-nithin',
        'Router      live',
        'Endpoint    https://sb-3fd1.sandbox.wundergraph.dev/graphql',
        '',
      ].join('\n'),
    );
    expect(json.json()).toEqual({
      ok: true,
      data: {
        address: 'shop/shop-nithin',
        endpointUrl: 'https://sb-3fd1.sandbox.wundergraph.dev/graphql',
        routerStatus: 'live',
      },
    });
    expect(hub.toolCalls()[0]).toEqual({ name: 'get_sandbox', arguments: { sandbox: 'shop/shop-nithin' } });
  });

  test('--sandbox wins over WGC_SANDBOX, which wins over the link', async () => {
    hub = await startFakeHub({ tools: getSandboxTool() });
    const dir = await linkedRepo();

    await runWgc(['hub', 'status', '--sandbox', 'shop/flag'], {
      hubUrl: hub.url,
      cwd: dir,
      env: { WGC_SANDBOX: 'shop/env' },
    });
    await runWgc(['hub', 'status'], { hubUrl: hub.url, cwd: dir, env: { WGC_SANDBOX: 'shop/env' } });
    await runWgc(['hub', 'status'], { hubUrl: hub.url, cwd: dir });

    expect(hub.toolCalls().map((call) => call.arguments)).toEqual([
      { sandbox: 'shop/flag' },
      { sandbox: 'shop/env' },
      { sandbox: 'shop/shop-nithin' },
    ]);
  });

  test('an unlinked directory exits 2 with the ways to pick a sandbox', async () => {
    const dir = await tempRepo({});

    const run = await runWgc(['hub', 'status'], { cwd: dir, output: 'text' });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toBe(
      `error: No sandbox is linked to ${dir}.\n` +
        'Pass --sandbox <schema>/<sandbox>, set WGC_SANDBOX, or link this directory with `wgc hub link <sandbox>`.\n',
    );
  });
});

const accessTool = () => ({
  describe_current_access: () => ({
    structuredContent: {
      organizationSlug: 'acme',
      role: 'editor',
      canMakeChanges: true,
      token: null,
      activeSandbox: null,
    },
  }),
});

describe('wgc hub open', () => {
  test('prints the page URL in the organization Hub reports when the caller is not a person', async () => {
    hub = await startFakeHub({ tools: accessTool() });
    const dir = await linkedRepo();

    const sandbox = await runWgc(['hub', 'open'], { cwd: dir, output: 'text', hubUrl: hub.url });
    const operation = await runWgc(['hub', 'open', 'operation', 'op_7Kq2', '--json'], { cwd: dir, hubUrl: hub.url });
    const proposal = await runWgc(['hub', 'open', 'proposal', '--print'], {
      cwd: dir,
      output: 'text',
      hubUrl: hub.url,
    });

    expect(sandbox.stdout).toBe(`${hub.url}/acme/graph/shop?view=shop-nithin\n`);
    expect(operation.json()).toEqual({
      ok: true,
      data: { url: `${hub.url}/acme/operations/op_7Kq2`, opened: false },
      url: `${hub.url}/acme/operations/op_7Kq2`,
    });
    expect(proposal.stdout).toBe(`${hub.url}/acme/graph/shop?tab=proposal&view=shop-nithin\n`);
    expect(hub.toolCalls()[0]).toEqual({ name: 'describe_current_access', arguments: {} });
  });

  test('opens a sandbox picked with --sandbox', async () => {
    hub = await startFakeHub({ tools: accessTool() });

    const run = await runWgc(['hub', 'open', '--sandbox', 'shop/checkout'], {
      hubUrl: hub.url,
      cwd: await tempRepo({}),
      output: 'text',
    });

    expect(run.stdout).toBe(`${hub.url}/acme/graph/shop?view=checkout\n`);
  });

  test('an operation without its id is a usage error', async () => {
    const run = await runWgc(['hub', 'open', 'operation'], { cwd: await linkedRepo() });

    expect(run.exitCode).toBe(2);
  });
});
