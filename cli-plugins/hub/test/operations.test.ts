import { afterEach, describe, expect, test } from 'vitest';
import { FakeHub, hubOperation, linkedRepo, runWgc, sequence, startFakeHub, step } from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const checkoutSteps = (statuses: string[]) => [
  step('AddToCart', statuses[0], 38),
  step('ApplyCoupon', statuses[1], 51),
  step('PlaceOrder', statuses[2], 12, 'expected data.placeOrder.status = "PAID", got "PENDING"'),
  step('ConfirmEmail', statuses[3], null, 'depends on PlaceOrder'),
];

const failedRun = hubOperation({
  id: 'op_C1x8',
  kind: 'collection.run',
  status: 'failed',
  steps: checkoutSteps(['succeeded', 'succeeded', 'failed', 'skipped']),
  error: { code: 'COLLECTION_ASSERTIONS_FAILED', message: '1 of 4 operations failed.' },
});

describe('wgc hub collection run', () => {
  test('--detach prints the operation and how to watch it', async () => {
    hub = await startFakeHub({
      tools: {
        run_collection: () => ({
          structuredContent: { operation: hubOperation({ id: 'op_C1x8', kind: 'collection.run', status: 'queued' }) },
        }),
      },
    });

    const run = await runWgc(['hub', 'collection', 'run', 'checkout', '--detach'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      [
        'Started collection run op_C1x8',
        '  https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_C1x8',
        'Watch   wgc hub operation watch op_C1x8',
        '',
      ].join('\n'),
    );
    expect(hub.toolCalls()).toEqual([
      {
        name: 'run_collection',
        arguments: { sandbox_id: 'sb_3fd1', collection: 'checkout', idempotency_key: 'generated-key' },
      },
    ]);
  });

  test('attached, it prints the URL first and exits 3 when an assertion fails', async () => {
    hub = await startFakeHub({
      tools: {
        run_collection: () => ({
          structuredContent: {
            operation: hubOperation({
              id: 'op_C1x8',
              kind: 'collection.run',
              steps: checkoutSteps(['pending', 'pending', 'pending', 'pending']),
            }),
          },
        }),
        get_operation: () => ({ structuredContent: { operation: failedRun } }),
      },
    });

    const run = await runWgc(['hub', 'collection', 'run', 'checkout'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.exitCode).toBe(3);
    expect(run.stderr.split('\n').slice(0, 3)).toEqual([
      'Running collection checkout in sb_3fd1',
      '  https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_C1x8',
      '',
    ]);
    expect(run.stdout).toBe('2 passed, 1 failed, 1 skipped\n');
  });
});

describe('wgc hub operation', () => {
  test('watch re-attaches to an operation started anywhere and exits 3 on failed assertions', async () => {
    hub = await startFakeHub({
      tools: {
        get_operation: sequence([
          {
            structuredContent: {
              operation: hubOperation({
                id: 'op_C1x8',
                kind: 'collection.run',
                steps: checkoutSteps(['succeeded', 'running', 'pending', 'pending']),
              }),
            },
          },
          { structuredContent: { operation: failedRun } },
        ]),
      },
    });

    const run = await runWgc(['hub', 'operation', 'watch', 'op_C1x8'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
    });

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toBe(
      [
        '  ✓ AddToCart           38ms',
        '  ✓ ApplyCoupon         51ms',
        '  ✗ PlaceOrder          expected data.placeOrder.status = "PAID", got "PENDING"',
        '  · ConfirmEmail        skipped (depends on PlaceOrder)',
        '',
        '',
      ].join('\n'),
    );
    expect(run.stdout).toBe('2 passed, 1 failed, 1 skipped\n');
    expect(hub.toolCalls().map((call) => call.arguments)).toEqual([
      { operation_id: 'op_C1x8' },
      { operation_id: 'op_C1x8', wait_seconds: 30 },
    ]);
  });

  test('watch in JSON prints events and steps on stderr and the operation envelope on stdout', async () => {
    const succeeded = hubOperation({
      id: 'op_6Pd0',
      kind: 'forge.check',
      status: 'succeeded',
      steps: [step('Compose supergraph', 'succeeded', 700)],
      events: [{ at: '2026-11-20T11:56:10Z', message: 'Fetched 3 sources', step: 'Compose supergraph' }],
    });
    hub = await startFakeHub({ tools: { get_operation: () => ({ structuredContent: { operation: succeeded } }) } });

    const run = await runWgc(['hub', 'operation', 'watch', 'op_6Pd0'], { hubUrl: hub.url, cwd: await linkedRepo() });

    expect(run.exitCode).toBe(0);
    expect(
      run.stderr
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        event: 'operation_event',
        operation: 'op_6Pd0',
        at: '2026-11-20T11:56:10Z',
        step: 'Compose supergraph',
        message: 'Fetched 3 sources',
      },
      {
        event: 'step',
        operation: 'op_6Pd0',
        name: 'Compose supergraph',
        status: 'succeeded',
        duration_ms: 700,
        detail: null,
      },
    ]);
    expect(run.json()).toMatchObject({
      ok: true,
      operation: { id: 'op_6Pd0', status: 'succeeded' },
      data: { operation: { id: 'op_6Pd0', kind: 'forge.check', origin: { surface: 'cli', client: 'wgc' } } },
      url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_6Pd0',
    });
  });

  test('wait gives up after --timeout with exit 1 and leaves the operation running', async () => {
    hub = await startFakeHub({
      tools: { get_operation: () => ({ structuredContent: { operation: hubOperation({ status: 'running' }) } }) },
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
      url: 'https://hub.wundergraph.com/acme/graph/shop/sandboxes/sb_3fd1/operations/op_7Kq2',
    });
  });

  test('cancel stops a running operation and reports no change for a finished one', async () => {
    hub = await startFakeHub({
      tools: {
        get_operation: sequence([
          { structuredContent: { operation: hubOperation({ status: 'running' }) } },
          { structuredContent: { operation: hubOperation({ status: 'cancelled' }) } },
        ]),
        cancel_operation: () => ({ structuredContent: { operation: hubOperation({ status: 'cancelled' }) } }),
      },
    });
    const dir = await linkedRepo();

    const first = await runWgc(['hub', 'operation', 'cancel', 'op_7Kq2'], {
      hubUrl: hub.url,
      cwd: dir,
      output: 'text',
    });
    const second = await runWgc(['hub', 'operation', 'cancel', 'op_7Kq2', '--json'], { hubUrl: hub.url, cwd: dir });

    expect(first.stdout).toBe('Cancelled op_7Kq2 (sandbox.launch)\n');
    expect(second.json()).toMatchObject({
      ok: true,
      changed: false,
      operation: { id: 'op_7Kq2', status: 'cancelled' },
    });
    expect(hub.toolCalls().filter((call) => call.name === 'cancel_operation')).toHaveLength(1);
  });

  test('list shows each operation with the surface that started it', async () => {
    hub = await startFakeHub({
      tools: {
        list_operations: () => ({
          structuredContent: {
            operations: [
              hubOperation({ id: 'op_7Kq2', status: 'succeeded' }),
              {
                ...hubOperation({ id: 'op_6Pd0', kind: 'forge.check', status: 'failed' }),
                origin: { surface: 'ui', client: null },
              },
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
      [
        'op_7Kq2  sandbox.launch  succeeded  cli (wgc)  4m ago',
        'op_6Pd0  forge.check     failed     ui         4m ago',
        '',
      ].join('\n'),
    );
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
