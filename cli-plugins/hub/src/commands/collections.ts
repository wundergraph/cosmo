import { Command } from 'commander';
import pc from 'picocolors';
import type { PluginContext, ToolArgument } from '@wundergraph/wgc-plugin-sdk';
import { reportFailure } from '../common/failure.js';
import { connectHub, runCollectionResult } from '../common/hub.js';
import { sandboxFileName } from '../common/sandbox-config.js';
import { resolveTarget, TargetOptions } from '../common/target.js';

interface RunOptions extends TargetOptions {
  sandbox?: string;
  json?: boolean;
}

const runCollections = async (
  collection: string | undefined,
  options: RunOptions,
  context: PluginContext,
): Promise<void> => {
  const output = context.output({ json: options.json });
  const target = await resolveTarget(options);
  if (!target.success) {
    reportFailure(output, target.errors);
    return;
  }

  const args: Record<string, ToolArgument> = { schema: target.data.schema };
  if (options.sandbox) {
    args.sandbox = options.sandbox;
  }
  if (collection) {
    args.collection = collection;
  } else if (target.data.config?.collections) {
    args.pattern = target.data.config.collections;
  }

  output.progress({
    step: 'run',
    subject: collection ?? 'collections',
    message: `Running against ${options.sandbox ?? 'the schema'} in ${target.data.schema}`,
  });
  const ran = await connectHub(context, target.data.audience).callTool('run_collection', args, runCollectionResult);
  if (!ran.success) {
    reportFailure(output, ran.errors);
    return;
  }

  const { results, sandbox } = ran.data;
  for (const result of results) {
    const verdict = result.passed ? 'passed' : `failed: ${result.error ?? 'no error message'}`;
    output.progress({
      step: 'operation',
      subject: `${result.collection}/${result.operation}`,
      message: `${verdict} in ${result.durationMs}ms`,
    });
  }

  const failed = results.filter((result) => !result.passed);
  const summary = { sandbox, total: results.length, passed: results.length - failed.length, results };
  if (failed.length > 0) {
    output.fail({
      message: `${failed.length} of ${results.length} operations failed in ${sandbox}: ${failed
        .map((result) => `${result.collection}/${result.operation}`)
        .join(', ')}`,
      fix: 'Fix the failing operations or the schema, then run the collection again.',
    });
    return;
  }
  output.result(summary, (data) => `${pc.green(`${data.passed}/${data.total} operations passed`)} in ${data.sandbox}`);
};

export const collectionsCommand = (context: PluginContext): Command =>
  new Command('collections').description('Run Hub operation collections').addCommand(
    new Command('run')
      .description('Run one collection, or every collection matching sandbox.yaml `collections`, against a sandbox')
      .argument('[collection]', 'Collection name')
      .option('--sandbox <name>', 'Sandbox to run against (default: Hub picks the schema main view)')
      .option('--schema <slug>', 'Hub schema slug (default: sandbox.yaml `schema`)')
      .option('--config <path>', 'Path to sandbox.yaml', sandboxFileName)
      .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: sandbox.yaml `audience` or hub)')
      .option('--json', 'Print the result as JSON')
      .action((collection: string | undefined, options: RunOptions) => runCollections(collection, options, context)),
  );
