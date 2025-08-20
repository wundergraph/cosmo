import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('link');
  command.description('Links a subgraph to another subgraph on the control plane.');
  command.argument('<source-subgraph-name>', 'The name of the subgraph to link.');
  command.option('-n, --namespace [string]', 'The namespace of the source subgraph.', 'default');
  command.requiredOption('--ts, --target-subgraph-name [string]', 'The name of the subgraph to link to.');
  command.requiredOption('--tn, --target-namespace [string]', 'The namespace of the target subgraph.');

  command.action(async (name, options) => {
    const spinner = ora(`The subgraph "${name}" is being linked to "${options.targetSubgraphName}"...`).start();

    const resp = await opts.client.platform.linkSubgraph(
      {
        sourceSubgraphName: name,
        sourceSubgraphNamespace: options.namespace,
        targetSubgraphName: options.targetSubgraphName,
        targetSubgraphNamespace: options.targetNamespace,
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
