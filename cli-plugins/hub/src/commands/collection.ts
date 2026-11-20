import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { asGroup, openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import type { CollectionResult } from '../common/contract.js';
import { formatDuration, nameColumnWidth, renderRow } from '../common/operation.js';
import type { HubDependencies } from '../common/runtime.js';

const resultOutcome = (result: CollectionResult): string =>
  result.passed ? formatDuration(result.durationMs) : (result.error ?? `status ${result.status}`);

/** `2 passed, 1 failed`; a zero failed count is left out. */
const tally = (data: { passed: number; failed: number }): string =>
  data.failed > 0 ? `${data.passed} passed, ${data.failed} failed` : `${data.passed} passed`;

const runCollection = async (collection: string, options: SandboxOptions, dependencies: HubDependencies) => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  output.message(`Running collection ${collection} in ${selection.sandbox}`);

  const ran = await hub.callTool(
    hubTools.runCollection,
    { sandbox: selection.sandbox, collection },
    hubResults.runCollection,
  );
  if (!ran.success) {
    output.fail(toFailure(ran));
    return;
  }

  const { results, failed } = ran.data;
  const width = nameColumnWidth(results.map((result) => result.operation));
  for (const result of results) {
    output.message(renderRow(result.passed ? '✓' : '✗', result.operation, width, resultOutcome(result)), {
      event: 'collection_result',
      collection: result.collection,
      operation: result.operation,
      passed: result.passed,
      status: result.status,
      duration_ms: result.durationMs,
      error: result.error,
    });
  }
  if (results.length > 0) {
    output.message('');
  }

  if (failed > 0) {
    output.fail(
      {
        kind: 'findings',
        code: 'COLLECTION_ASSERTIONS_FAILED',
        message: `${failed} of ${results.length} operations failed.`,
        data: ran.data,
      },
      tally,
    );
    return;
  }
  output.result(ran.data, tally);
};

export const collectionCommand = (dependencies: HubDependencies): Command =>
  asGroup(new Command('collection').description('Run saved operation collections'), dependencies.context).addCommand(
    withExamples(
      withSandboxOptions(
        new Command('run')
          .description('Run every operation of a collection against the sandbox. Exits 3 when one fails.')
          .argument('<name>', 'Collection name'),
      ),
      ['wgc hub collection run smoke', 'wgc hub collection run checkout --json'],
      'collection/run',
    ).action((collection: string, options: SandboxOptions) => runCollection(collection, options, dependencies)),
  );
