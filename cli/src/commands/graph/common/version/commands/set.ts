import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import pc from 'picocolors';
import Table from 'cli-table3';
import { ROUTER_COMPATIBILITY_VERSIONS, SupportedRouterCompatibilityVersion } from '@wundergraph/composition';
import ora from 'ora';
import { getBaseHeaders } from '../../../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../../../core/types/types.js';
import { handleCompositionResult } from '../../../../../handle-composition-result.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('set');
  command.description(`Sets a router compatibility version for the specified ${graphType}.`);
  command.argument('<name>', `The name of the ${graphType} for which to set the router compatibility version.`);
  command.requiredOption('-v --version [number]', `The router compatibility version to set for the ${graphType}.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('-o, --out [string]', 'Destination file for the SDL.');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.action(async (name, options) => {
    const spinner = ora('Validating the router compatibility version change...').start();

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

    if (!response.response) {
      console.log(`${pc.red(`Failed to set router compatibility version for ${graphType} "${pc.bold(name)}".`)}`);
      process.exit(1);
    }

    if (response.response.code === EnumStatusCode.ERR_NOT_FOUND) {
      console.log(`${pc.red(`No valid record could be found for ${graphType} "${pc.bold(name)}".`)}`);
      console.log(`Please check the name and namespace for the ${graphType} in Cosmo Studio.`);
      if (response.response?.details) {
        console.log(pc.red(pc.bold(response.response.details)));
      }
      process.exit(1);
    }

    if (response.response.code === EnumStatusCode.ERR_BAD_REQUEST) {
      console.log(
        `${pc.red(
          `${options.version} is not a valid router compatibility version. Please input one of the following valid versions:`,
        )}`,
      );
      const validVersionsTable = new Table({
        wordWrap: true,
        wrapOnWordBoundary: false,
      });

      validVersionsTable.push([pc.bold(pc.white('VERSION')), ...ROUTER_COMPATIBILITY_VERSIONS]);
      console.log(validVersionsTable.toString());
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

    versionsTable.push([name, options.namespace || 'default', response.previousVersion, response.newVersion]);

    try {
      handleCompositionResult({
        responseCode: response.response.code,
        responseDetails: response.response.details,
        compositionErrors: response.compositionErrors,
        compositionWarnings: response.compositionWarnings,
        deploymentErrors: response.deploymentErrors,
        spinner,
        successMessage: `Successfully set the router compatibility version for ${graphType} "${pc.bold(name)}" to ${
          options.version
        }.`,
        subgraphCompositionBaseErrorMessage:
          `The router composition version for ${graphType} "${pc.bold(name)}" was set to ${options.version}.` +
          ` However, the new composition was unsuccessful.`,
        subgraphCompositionDetailedErrorMessage:
          `There were composition errors when recomposing ${graphType} "${pc.bold(
            name,
          )}" using router compatibility version ${options.version}.` +
          `\n${pc.bold('Please check the errors below:')}`,
        deploymentErrorMessage:
          `The ${graphType} "${pc.bold(name)}" was recomposed with new router compatibility version ${
            options.version
          } but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to set the router compatibility version for ${graphType} "${pc.bold(name)}" to ${
          options.version
        }.`,
        suppressWarnings: options.suppressWarnings,
      });
    } catch {
      console.log(versionsTable.toString());
      process.exit(1);
    }
    console.log(versionsTable.toString());
  });

  return command;
};
