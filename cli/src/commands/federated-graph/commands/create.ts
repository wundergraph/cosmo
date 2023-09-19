import Table from 'cli-table3';
import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const createFederatedGraph = new Command('create');
  createFederatedGraph.description('Creates a federated graph on the control plane.');
  createFederatedGraph.argument(
    '<name>',
    'The name of the federated graph to create. It is usually in the format of <org>.<env> and is used to uniquely identify your federated graph.',
  );
  createFederatedGraph.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  createFederatedGraph.requiredOption(
    '--label-matcher [labels...]',
    'The label matcher is used to select the subgraphs to federate. The labels are passed in the format <key>=<value> <key>=<value>. They are separated by spaces and grouped using comma. Example: --label-matcher team=A,team=B env=prod',
  );
  createFederatedGraph.action(async (name, options) => {
    const resp = await opts.client.platform.createFederatedGraph(
      {
        name,
        routingUrl: options.routingUrl,
        labelMatchers: options.labelMatcher,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`A new federated graph called '${name}' was created.`)));
    } else if (resp.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED) {
      console.log(pc.dim(pc.green(`A new federated graph called '${name}' was created.`)));

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
      console.log(`Failed to create federated graph ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return createFederatedGraph;
};
