import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { announceOperation, asGroup, openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import { followOperation, renderStarted, reportFinished, reportUnfinished } from '../common/operation.js';
import type { HubDependencies } from '../common/runtime.js';

interface RunOptions extends SandboxOptions {
  detach?: boolean;
  idempotencyKey?: string;
}

const runCollection = async (collection: string, options: RunOptions, dependencies: HubDependencies) => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  if (!options.detach) {
    output.message(`Running collection ${collection} in ${selection.sandboxId}`);
  }

  const started = await hub.callTool(
    hubTools.runCollection,
    {
      sandbox_id: selection.sandboxId,
      collection,
      idempotency_key: options.idempotencyKey ?? runtime.newIdempotencyKey(),
    },
    hubResults.runCollection,
  );
  if (!started.success) {
    output.fail(toFailure(started));
    return;
  }

  const { operation } = started.data;
  if (options.detach) {
    output.result({ operation: { id: operation.id, status: operation.status } }, () => renderStarted(operation), {
      operation: { id: operation.id, status: operation.status },
      url: operation.url,
    });
    return;
  }

  announceOperation(output, operation);
  const followed = await followOperation({ hub, output, runtime, operation });
  if (!followed.success) {
    output.fail(toFailure(followed));
    return;
  }
  if (followed.data.kind !== 'finished') {
    reportUnfinished(output, followed.data);
    return;
  }
  reportFinished(output, followed.data.operation);
};

export const collectionCommand = (dependencies: HubDependencies): Command =>
  asGroup(new Command('collection').description('Run saved operation collections'), dependencies.context).addCommand(
    withExamples(
      withSandboxOptions(
        new Command('run')
          .description('Run a collection against the sandbox. Exits 3 when an assertion fails.')
          .argument('<name>', 'Collection name')
          .option('--detach', 'Return once Hub accepted the run; watch it with `wgc hub operation watch`')
          .option('--idempotency-key <key>', 'Repeat a run safely: Hub returns the first run for the same key'),
      ),
      ['wgc hub collection run smoke', 'wgc hub collection run checkout --detach --json'],
      'collection/run',
    ).action((collection: string, options: RunOptions) => runCollection(collection, options, dependencies)),
  );
