import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { FakeHub, runWgc, startFakeHub, tempRepo } from './harness.js';

const sandbox = (name: string) => ({
  name,
  schema: 'shop',
  status: 'running',
  url: `https://hub.example/shop/sandboxes/${name}`,
  routerUrl: `https://${name}.sandbox.example/graphql`,
});

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const sandboxYaml = `schema: shop
subgraphs:
  - name: products
    schema: products.graphql
    url: https://products.example.com/graphql
  - name: reviews
    schema: reviews.graphql
`;

describe('wgc hub sandbox', () => {
  test('create sends the schema, name, source sandbox and subgraph URL targets from sandbox.yaml', async () => {
    hub = await startFakeHub({
      tools: { create_sandbox: () => ({ structuredContent: { sandbox: sandbox('checkout') } }) },
    });
    const dir = await tempRepo({ 'sandbox.yaml': sandboxYaml });

    const run = await runWgc(
      ['hub', 'sandbox', 'create', 'checkout', '--from', 'main', '--config', path.join(dir, 'sandbox.yaml'), '--json'],
      { hubUrl: hub.url },
    );

    expect(run.exitCode).toBe(0);
    expect(hub.toolCalls()).toEqual([
      {
        name: 'create_sandbox',
        arguments: {
          schema: 'shop',
          name: 'checkout',
          subgraphs: [{ name: 'products', url: 'https://products.example.com/graphql' }],
          from: 'main',
        },
      },
    ]);
    expect(run.json()).toEqual({ status: 'success', sandbox: sandbox('checkout') });
  });

  test('list takes the schema from --schema without a sandbox.yaml', async () => {
    hub = await startFakeHub({
      tools: { list_sandboxes: () => ({ structuredContent: { sandboxes: [sandbox('a'), sandbox('b')] } }) },
    });
    const dir = await tempRepo({});

    const run = await runWgc(
      ['hub', 'sandbox', 'list', '--schema', 'shop', '--config', path.join(dir, 'sandbox.yaml'), '--json'],
      { hubUrl: hub.url },
    );

    expect(hub.toolCalls()).toEqual([{ name: 'list_sandboxes', arguments: { schema: 'shop' } }]);
    expect(run.json()).toEqual({ status: 'success', sandboxes: [sandbox('a'), sandbox('b')] });
  });

  test('list without --schema or sandbox.yaml fails with the fix', async () => {
    const dir = await tempRepo({});

    const run = await runWgc(['hub', 'sandbox', 'list', '--config', path.join(dir, 'sandbox.yaml'), '--json']);

    expect(run.exitCode).toBe(1);
    expect(run.json()).toMatchObject({
      status: 'error',
      error: { fix: 'Pass `--schema <slug>`, or run `wgc hub init` to create sandbox.yaml.' },
    });
  });

  test('open prints the sandbox URL for a non-human caller instead of opening a browser', async () => {
    hub = await startFakeHub({
      tools: { get_sandbox: () => ({ structuredContent: { sandbox: sandbox('checkout') } }) },
    });

    const run = await runWgc(
      ['hub', 'sandbox', 'open', 'checkout', '--schema', 'shop', '--config', '/nonexistent/sandbox.yaml'],
      {
        hubUrl: hub.url,
      },
    );

    expect(hub.toolCalls()).toEqual([{ name: 'get_sandbox', arguments: { schema: 'shop', name: 'checkout' } }]);
    expect(run.json()).toEqual({ status: 'success', sandbox: sandbox('checkout'), opened: false });
  });

  test('surfaces a Hub tool error', async () => {
    hub = await startFakeHub({
      tools: { get_sandbox: () => ({ isError: true, text: 'Sandbox nope does not exist' }) },
    });

    const run = await runWgc(
      ['hub', 'sandbox', 'open', 'nope', '--schema', 'shop', '--config', '/nonexistent/sandbox.yaml', '--json'],
      {
        hubUrl: hub.url,
      },
    );

    expect(run.exitCode).toBe(1);
    expect(run.json()).toEqual({ status: 'error', error: { message: 'Sandbox nope does not exist' } });
  });
});
