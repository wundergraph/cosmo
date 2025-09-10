import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('link');
  command.description(
    'Links a subgraph to another subgraph on the control plane. When performing schema checks on the source subgraph, traffic and pruning checks will also be performed on the target subgraph. This is useful for verifying the impact of the schema changes before they are propagated to the next environment.',
  );
  command.argument('<source-subgraph-name>', 'The name of the subgraph to link.');
  command.option('-n, --namespace <string>', 'The namespace of the source subgraph.', 'default');
  command.requiredOption(
    '-t, --target-subgraph <string>',
    'The name of the subgraph to link to. Format: <namespace>/<subgraph-name>',
  );

  command.action(async (name, options) => {
    // Split on all slashes, take first as namespace, join rest as subgraph name
    const [targetNamespace, ...rest] = options.targetSubgraph.split('/');
    if (!targetNamespace || rest.length === 0) {
      program.error('Target subgraph must be in the format <namespace>/<subgraph-name>');
    }

    const targetSubgraphName = rest.join('/');

    // Prevent self-linking
    if (options.namespace === targetNamespace && name === targetSubgraphName) {
      program.error('The source and target subgraphs cannot be the same subgraphs.');
    }

    const spinner = ora(`The subgraph "${name}" is being linked to "${targetSubgraphName}"...`).start();

    const resp = await opts.client.platform.linkSubgraph(
      {
        sourceSubgraphName: name,
        sourceSubgraphNamespace: options.namespace,
        targetSubgraphName,
        targetSubgraphNamespace: targetNamespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('Subgraph was linked successfully.');
    } else {
      spinner.fail('Failed to link subgraph.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exitCode = 1;
      // eslint-disable-next-line no-useless-return
      return;
    }
  });

  return command;
};
