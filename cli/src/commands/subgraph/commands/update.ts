import Table from 'cli-table3';
import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates a subgraph on the control plane.');
  command.argument('<name>', 'The name of the subgraph to update.');
  command.option(
    '-r, --routing-url <url>',
    'The routing url of your subgraph. This is the url that the subgraph will be accessible at.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the subgraph. The labels are passed in the format <key>=<value> <key>=<value>.',
  );
  command.option(
    '--header [headers...]',
    'The headers to apply when the subgraph is introspected. This is used for authentication and authorization.',
  );
  command.action(async (name, options) => {
    const resp = await opts.client.platform.updateSubgraph(
      {
        name,
        labels:
          options.label?.map?.((label: string) => {
            const { key, value } = splitLabel(label);
            return {
              key,
              value,
            };
          }) ?? [],
        routingUrl: options.routingUrl,
        headers: options.header,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`Subgraph '${name}' was updated.`)));
    } else if (resp.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED) {
      console.log(pc.dim(pc.green(`Subgraph called '${name}' was updated.`)));

      const compositionErrorsTable = new Table({
        head: [pc.bold(pc.white('FEDERATED_GRAPH_NAME')), pc.bold(pc.white('ERROR_MESSAGE'))],
        colWidths: [30, 120],
        wordWrap: true,
      });

      console.log(
        pc.yellow(
          'But we found composition errors, while composing the federated graph.\nThe graph will not be updated until the errors are fixed. Please check the errors below:',
        ),
      );
      for (const compositionError of resp.compositionErrors) {
        compositionErrorsTable.push([compositionError.federatedGraphName, compositionError.message]);
      }
      // Don't exit here with 1 because the change was still applied
      console.log(compositionErrorsTable.toString());
    } else {
      console.log(`Failed to update subgraph ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
