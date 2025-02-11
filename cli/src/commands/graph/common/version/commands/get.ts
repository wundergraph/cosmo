import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import Table from 'cli-table3';
import { getBaseHeaders } from '../../../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../../../core/types/types.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('get');
  command.description(`Fetches the router compatibility version currently set for the specified ${graphType}.`);
  command.argument('<name>', `The name of the ${graphType} for which to fetch the router compatibility version.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.action(async (name, options) => {
    const response = await opts.client.platform.getFederatedGraphByName(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (response.response?.code === EnumStatusCode.ERR_NOT_FOUND || !response.graph) {
      console.log(`${pc.red(`No valid record could be found for ${graphType} ${pc.bold(name)}.`)}`);
      console.log(`Please check the name and namespace for the ${graphType} in Cosmo Studio.`);
      if (response.response?.details) {
        console.log(pc.red(pc.bold(response.response?.details)));
      }
      process.exit(1);
    }

    const versionsTable = new Table({
      head: [pc.bold(pc.white('GRAPH NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('VERSION'))],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    versionsTable.push([name, response.graph.namespace, response.graph.routerCompatibilityVersion]);

    console.log(versionsTable.toString());
  });

  return command;
};
