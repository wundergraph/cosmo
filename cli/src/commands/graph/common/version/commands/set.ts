import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import Table from 'cli-table3';
import { ROUTER_COMPATIBILITY_VERSIONS } from '@wundergraph/composition';
import { getBaseHeaders } from '../../../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../../../core/types/types.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('get');
  command.description(`Sets a router compatibility version for the specified ${graphType}.`);
  command.argument('<name>', `The name of the ${graphType} for which to set the router compatibility version.`);
  command.requiredOption('-v --version', `The router compatibility version to set for the ${graphType}.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('-o, --out [string]', 'Destination file for the SDL.');
  command.action(async (name, options) => {
    if (!ROUTER_COMPATIBILITY_VERSIONS.has(options.version)) {
      console.log(
        `${pc.red(
          `"${options.version}" is not a valid router compatibility version. Please input one of the following valid versions:\n`,
        )}`,
      );
      console.log([...ROUTER_COMPATIBILITY_VERSIONS].join(', '));
      process.exit(1);
    }
    const response = await opts.client.platform.setGraphRouterCompatibilityVersion(
      {
        name,
        namespace: options.namespace,
        version: options.version,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (response.response?.code === EnumStatusCode.ERR_NOT_FOUND) {
      console.log(`${pc.red(`No valid composition could be fetched for ${graphType} ${pc.bold(name)}`)}`);
      console.log(`Please check the name and the composition status of the ${graphType} in the Studio.`);
      if (response.response?.details) {
        console.log(pc.red(pc.bold(response.response?.details)));
      }
      process.exit(1);
    }

    const versionsTable = new Table({
      head: [
        pc.bold(pc.white('GRAPH NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('PREVIOUS VERSION')),
        pc.bold(pc.white('NEW VERSION')),
      ],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    versionsTable.push([name, options.namespace, response.previousVersion, response.newVersion]);

    console.log(versionsTable.toString());
  });

  return command;
};
