import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('unlink');
  command.description('Unlinks a subgraph from another subgraph on the control plane.');
  command.argument('<source-subgraph-name>', 'The name of the subgraph to unlink.');
  command.option('-n, --namespace <string>', 'The namespace of the source subgraph.', 'default');

  command.action(async (name, options) => {
    const spinner = ora(`The subgraph "${name}" is being unlinked...`).start();

    const resp = await opts.client.platform.unlinkSubgraph(
      {
        sourceSubgraphName: name,
        sourceSubgraphNamespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('Subgraph was unlinked successfully.');
    } else {
      spinner.fail('Failed to unlink subgraph.');
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
