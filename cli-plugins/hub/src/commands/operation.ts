import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { asGroup, openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import { connectHub } from '../common/hub.js';
import { fetchOperation, followOperation, isFinished, reportFinished, reportUnfinished } from '../common/operation.js';
import type { HubDependencies } from '../common/runtime.js';
import { resolveAudience } from '../common/target.js';
import { formatAge, parseDuration } from '../common/time.js';

interface OperationOptions {
  audience?: string;
  json?: boolean;
  timeout?: string;
}

const connect = (options: OperationOptions, dependencies: HubDependencies) =>
  connectHub(dependencies.context, resolveAudience(options, dependencies.runtime.env));

/** Streams the steps of an operation until it finishes; Ctrl-C detaches and leaves it running. */
const runFollow = async (
  operationId: string,
  options: OperationOptions,
  dependencies: HubDependencies,
  showSteps: boolean,
): Promise<void> => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });

  let deadline: Date | undefined;
  if (options.timeout !== undefined) {
    const timeoutMs = parseDuration(options.timeout);
    if (timeoutMs === undefined) {
      output.fail({
        kind: 'usage',
        message: `--timeout ${options.timeout} is not a duration.`,
        remediation: 'Pass a duration such as 30s, 10m or 1h.',
      });
      return;
    }
    deadline = new Date(runtime.now().getTime() + timeoutMs);
  }

  const hub = connect(options, dependencies);
  const fetched = await fetchOperation(hub, operationId);
  if (!fetched.success) {
    output.fail(toFailure(fetched));
    return;
  }

  const followed = await followOperation({
    hub,
    output,
    runtime,
    operation: fetched.data,
    showSteps,
    deadline,
  });
  if (!followed.success) {
    output.fail(toFailure(followed));
    return;
  }
  if (followed.data.kind !== 'finished') {
    reportUnfinished(output, followed.data, options.timeout);
    return;
  }
  reportFinished(output, followed.data.operation);
};

const runCancel = async (operationId: string, options: OperationOptions, dependencies: HubDependencies) => {
  const output = dependencies.context.output({ json: options.json });
  const hub = connect(options, dependencies);

  const fetched = await fetchOperation(hub, operationId);
  if (!fetched.success) {
    output.fail(toFailure(fetched));
    return;
  }

  const before = fetched.data;
  if (isFinished(before)) {
    output.result(
      { operation: before },
      (data) => `${data.operation.id} already ${data.operation.status}; nothing to cancel.`,
      { changed: false, operation: { id: before.id, status: before.status }, url: before.url },
    );
    return;
  }

  const cancelled = await hub.callTool(hubTools.cancelOperation, { operationId }, hubResults.cancelOperation);
  if (!cancelled.success) {
    output.fail(toFailure(cancelled));
    return;
  }

  const after = cancelled.data;
  output.result({ operation: after }, (data) => `Cancelled ${data.operation.id} (${data.operation.kind})`, {
    changed: true,
    operation: { id: after.id, status: after.status },
    url: after.url,
  });
};

const runList = async (options: SandboxOptions, dependencies: HubDependencies) => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const listed = await hub.callTool(hubTools.listOperations, { sandbox: selection.sandbox }, hubResults.listOperations);
  if (!listed.success) {
    output.fail(toFailure(listed));
    return;
  }

  const now = dependencies.runtime.now();
  output.result(listed.data, (data) => {
    if (data.operations.length === 0) {
      return `No operations in ${selection.sandbox} yet.`;
    }
    const rows = data.operations.map((operation) => [
      operation.id,
      operation.kind,
      operation.status,
      operation.origin,
      formatAge(operation.createdAt, now),
    ]);
    const widths = [0, 1, 2, 3].map((column) => Math.max(...rows.map((row) => row[column].length)));
    return rows
      .map((row) => row.map((cell, column) => (column < 4 ? cell.padEnd(widths[column]) : cell)).join('  '))
      .join('\n');
  });
};

const withHubOptions = (command: Command): Command =>
  command
    .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: HUB_OIDC_AUDIENCE or hub)')
    .option('--json', 'Machine-readable output');

export const operationCommand = (dependencies: HubDependencies): Command =>
  asGroup(
    new Command('operation').description('Follow, wait for and cancel Hub operations started from any surface'),
    dependencies.context,
  )
    .addCommand(
      withExamples(
        withHubOptions(
          new Command('watch')
            .description('Stream the steps of an operation until it finishes; Ctrl-C detaches')
            .argument('<operation>', 'Operation id, e.g. op_C1x8'),
        ),
        ['wgc hub operation watch op_C1x8', 'wgc hub operation watch op_C1x8 --json'],
        'operation/watch',
      ).action((operationId: string, options: OperationOptions) => runFollow(operationId, options, dependencies, true)),
    )
    .addCommand(
      withExamples(
        withHubOptions(
          new Command('wait')
            .description('Block until an operation finishes, without streaming its steps')
            .argument('<operation>', 'Operation id')
            .option('--timeout <duration>', 'Give up after this long, e.g. 10m; the operation keeps running'),
        ),
        ['wgc hub operation wait op_C1x8', 'wgc hub operation wait op_C1x8 --timeout 10m --json'],
        'operation/wait',
      ).action((operationId: string, options: OperationOptions) =>
        runFollow(operationId, options, dependencies, false),
      ),
    )
    .addCommand(
      withExamples(
        withHubOptions(
          new Command('cancel').description('Cancel a running operation').argument('<operation>', 'Operation id'),
        ),
        ['wgc hub operation cancel op_C1x8', 'wgc hub operation cancel op_C1x8 --json'],
        'operation/cancel',
      ).action((operationId: string, options: OperationOptions) => runCancel(operationId, options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(new Command('list').description('List the operations of the sandbox, newest first')),
        ['wgc hub operation list', 'wgc hub operation list --sandbox shop/shop-nithin --json'],
        'operation/list',
      ).action((options: SandboxOptions) => runList(options, dependencies)),
    );
