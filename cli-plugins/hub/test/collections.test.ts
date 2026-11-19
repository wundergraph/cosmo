import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { FakeHub, runWgc, startFakeHub, tempRepo } from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const operation = (name: string, passed: boolean, durationMs: number, error: string | null = null) => ({
  collection: 'checkout',
  operation: name,
  passed,
  durationMs,
  error,
});

describe('wgc hub collections run', () => {
  test('prints one progress line per operation and a passing summary', async () => {
    hub = await startFakeHub({
      tools: {
        run_collection: () => ({
          structuredContent: {
            sandbox: 'pr-42',
            results: [operation('GetCart', true, 12), operation('AddItem', true, 30)],
          },
        }),
      },
    });

    const run = await runWgc(
      [
        'hub',
        'collections',
        'run',
        'checkout',
        '--sandbox',
        'pr-42',
        '--schema',
        'shop',
        '--config',
        '/nonexistent/sandbox.yaml',
        '--json',
      ],
      { hubUrl: hub.url },
    );

    expect(run.exitCode).toBe(0);
    expect(hub.toolCalls()).toEqual([
      { name: 'run_collection', arguments: { schema: 'shop', sandbox: 'pr-42', collection: 'checkout' } },
    ]);
    expect(run.progress()).toEqual([
      'run checkout: Running against pr-42 in shop',
      'operation checkout/GetCart: passed in 12ms',
      'operation checkout/AddItem: passed in 30ms',
    ]);
    expect(run.json()).toEqual({
      status: 'success',
      sandbox: 'pr-42',
      total: 2,
      passed: 2,
      results: [operation('GetCart', true, 12), operation('AddItem', true, 30)],
    });
  });

  test('passes the sandbox.yaml collections glob when no collection is named, and exits non-zero on a failure', async () => {
    hub = await startFakeHub({
      tools: {
        run_collection: () => ({
          structuredContent: {
            sandbox: 'main',
            results: [operation('GetCart', true, 12), operation('AddItem', false, 41, 'Cannot query field "sku"')],
          },
        }),
      },
    });
    const dir = await tempRepo({
      'sandbox.yaml': 'schema: shop\ncollections: "checkout-*"\nsubgraphs:\n  - name: a\n    schema: a.graphql\n',
    });

    const run = await runWgc(['hub', 'collections', 'run', '--config', path.join(dir, 'sandbox.yaml'), '--json'], {
      hubUrl: hub.url,
    });

    expect(run.exitCode).toBe(1);
    expect(hub.toolCalls()).toEqual([{ name: 'run_collection', arguments: { schema: 'shop', pattern: 'checkout-*' } }]);
    expect(run.progress()).toContain('operation checkout/AddItem: failed: Cannot query field "sku" in 41ms');
    expect(run.json()).toEqual({
      status: 'error',
      error: {
        message: '1 of 2 operations failed in main: checkout/AddItem',
        fix: 'Fix the failing operations or the schema, then run the collection again.',
      },
    });
  });
});
