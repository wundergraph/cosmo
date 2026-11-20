import { afterEach, describe, expect, test } from 'vitest';
import {
  FakeHub,
  hubOperation,
  linkedRepo,
  operationSummary,
  operationUrl,
  runWgc,
  sequence,
  startFakeHub,
  step,
} from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const checkoutResult = (operation: string, passed: boolean, durationMs: number, error: string | null = null) => ({
  collection: 'checkout',
  operation,
  passed,
  status: 200,
  durationMs,
  response: '{"data":{}}',
  error,
});

describe('wgc hub collection run', () => {
  test('prints each operation and the tally, and exits 3 when one fails', async () => {
    hub = await startFakeHub({
      tools: {
        run_collection: () => ({
          structuredContent: {
            sandbox: 'shop/shop-nithin',
            passed: 2,
            failed: 1,
            results: [
              checkoutResult('AddToCart', true, 38),
              checkoutResult('ApplyCoupon', true, 510),
              checkoutResult('PlaceOrder', false, 12, 'expected data.placeOrder.status = "PAID", got "PENDING"'),
            ],
          },
        }),
      },
    });

    const run = await runWgc(['hub', 'collection', 'run', 'checkout'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toBe(
      [
        'Running collection checkout in shop/shop-nithin',
        '  ✓ AddToCart           38ms',
        '  ✓ ApplyCoupon         0.5s',
        '  ✗ PlaceOrder          expected data.placeOrder.status = "PAID", got "PENDING"',
        '',
        '',
      ].join('\n'),
    );
    expect(run.stdout).toBe('2 passed, 1 failed\n');
    expect(hub.toolCalls()).toEqual([
      { name: 'run_collection', arguments: { sandbox: 'shop/shop-nithin', collection: 'checkout' } },
    ]);
  });

  test('a passing run exits 0 with the results in the JSON envelope', async () => {
    hub = await startFakeHub({
      tools: {
        run_collection: () => ({
          structuredContent: {
            sandbox: 'shop/shop-nithin',
            passed: 1,
            failed: 0,
            results: [checkoutResult('AddToCart', true, 38)],
          },
        }),
      },
    });

    const run = await runWgc(['hub', 'collection', 'run', 'checkout', '--json'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
    });

    expect(run.exitCode).toBe(0);
    expect(run.json()).toMatchObject({
      ok: true,
      data: { passed: 1, failed: 0, results: [{ operation: 'AddToCart', passed: true, durationMs: 38 }] },
    });
  });
});

const checkoutSteps = (statuses: string[]) => [
  step('AddToCart', statuses[0]),
  step('ApplyCoupon', statuses[1]),
  step('PlaceOrder', statuses[2], 'expected data.placeOrder.status = "PAID", got "PENDING"'),
  step('ConfirmEmail', statuses[3], 'depends on PlaceOrder'),
];

describe('wgc hub operation', () => {
  test('watch re-attaches to an operation started anywhere and exits 3 on failed assertions', async () => {
    hub = await startFakeHub({
      tools: {
        get_operation: sequence([
          {
            structuredContent: hubOperation({
              id: 'op_C1x8',
              kind: 'run_collection',
              steps: checkoutSteps(['succeeded', 'running', 'running', 'running']),
            }),
          },
          {
            structuredContent: hubOperation({
              id: 'op_C1x8',
              kind: 'run_collection',
              status: 'failed',
              steps: checkoutSteps(['succeeded', 'succeeded', 'failed', 'skipped']),
              error: { code: 'COLLECTION_ASSERTIONS_FAILED', message: '1 of 4 operations failed.', remediation: null },
            }),
          },
        ]),
      },
    });

    const run = await runWgc(['hub', 'operation', 'watch', 'op_C1x8'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.exitCode).toBe(3);
    expect(run.stderr.split('\n').slice(0, 6)).toEqual([
      '  ✓ AddToCart',
      '  ✓ ApplyCoupon',
      '  ✗ PlaceOrder          expected data.placeOrder.status = "PAID", got "PENDING"',
      '  · ConfirmEmail        skipped (depends on PlaceOrder)',
      '',
      'error COLLECTION_ASSERTIONS_FAILED',
    ]);
    expect(hub.toolCalls().map((call) => call.arguments)).toEqual([
      { operationId: 'op_C1x8' },
      { operationId: 'op_C1x8' },
    ]);
  });

  test('watch in JSON prints steps on stderr and the operation envelope on stdout', async () => {
    const succeeded = hubOperation({
      id: 'op_6Pd0',
      kind: 'build_router',
      status: 'succeeded',
      steps: [step('Compose supergraph', 'succeeded')],
    });
    hub = await startFakeHub({ tools: { get_operation: () => ({ structuredContent: succeeded }) } });

    const run = await runWgc(['hub', 'operation', 'watch', 'op_6Pd0'], { hubUrl: hub.url, cwd: await linkedRepo() });

    expect(run.exitCode).toBe(0);
    expect(
      run.stderr
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([{ event: 'step', operation: 'op_6Pd0', name: 'Compose supergraph', status: 'succeeded', detail: '' }]);
    expect(run.json()).toMatchObject({
      ok: true,
      operation: { id: 'op_6Pd0', status: 'succeeded' },
      data: { operation: { id: 'op_6Pd0', kind: 'build_router', origin: 'cli', sandbox: 'shop/shop-nithin' } },
      url: operationUrl('op_6Pd0'),
    });
  });

  test('wait gives up after --timeout with exit 1 and leaves the operation running', async () => {
    hub = await startFakeHub({
      tools: { get_operation: () => ({ structuredContent: hubOperation({ status: 'running' }) }) },
    });

    const run = await runWgc(['hub', 'operation', 'wait', 'op_7Kq2', '--timeout', '0s', '--json'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe('');
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'WAIT_TIMEOUT',
        message: 'op_7Kq2 is still running after 0s. It keeps running in Hub.',
        next: ['wgc hub operation watch op_7Kq2'],
      },
      url: operationUrl('op_7Kq2'),
    });
  });

  test('cancel stops a running operation and reports no change for a finished one', async () => {
    hub = await startFakeHub({
      tools: {
        get_operation: sequence([
          { structuredContent: hubOperation({ kind: 'agent_run', status: 'running' }) },
          { structuredContent: hubOperation({ kind: 'agent_run', status: 'cancelled' }) },
        ]),
        cancel_operation: () => ({ structuredContent: operationSummary({ kind: 'agent_run', status: 'cancelled' }) }),
      },
    });
    const dir = await linkedRepo();

    const first = await runWgc(['hub', 'operation', 'cancel', 'op_7Kq2'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
    });
    const second = await runWgc(['hub', 'operation', 'cancel', 'op_7Kq2', '--json'], { hubUrl: hub.url, cwd: dir });

    expect(first.stdout).toBe('Cancelled op_7Kq2 (agent_run)\n');
    expect(second.json()).toMatchObject({
      ok: true,
      changed: false,
      operation: { id: 'op_7Kq2', status: 'cancelled' },
    });
    expect(hub.toolCalls().filter((call) => call.name === 'cancel_operation')).toEqual([
      { name: 'cancel_operation', arguments: { operationId: 'op_7Kq2' } },
    ]);
  });

  test('list shows each operation with the surface that started it', async () => {
    hub = await startFakeHub({
      tools: {
        list_operations: () => ({
          structuredContent: {
            operations: [
              operationSummary({ id: 'op_7Kq2', status: 'succeeded' }),
              operationSummary({ id: 'op_6Pd0', kind: 'build_router', status: 'failed', origin: 'ui' }),
            ],
          },
        }),
      },
    });

    const run = await runWgc(['hub', 'operation', 'list'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.stdout).toBe(
      ['op_7Kq2  launch_sandbox  succeeded  cli  4m ago', 'op_6Pd0  build_router    failed     ui   4m ago', ''].join(
        '\n',
      ),
    );
    expect(hub.toolCalls()).toEqual([{ name: 'list_operations', arguments: { sandbox: 'shop/shop-nithin' } }]);
  });

  test('a bare group prints its help and exits 0; an unknown subcommand exits 2', async () => {
    const bare = await runWgc(['hub', 'operation'], { output: 'text' });
    const unknown = await runWgc(['hub', 'operation', 'retry', 'op_1'], { output: 'text' });

    expect(bare.exitCode).toBe(0);
    expect(bare.stdout).toContain('watch [options] <operation>');
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toBe(
      'error: Unknown command: wgc hub operation retry.\nRun `wgc hub operation --help` to list its commands.\n',
    );
  });
});
