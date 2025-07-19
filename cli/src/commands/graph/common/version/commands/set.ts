import { ROUTER_COMPATIBILITY_VERSIONS } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../../../core/types/types.js';
import { handleCompositionResult } from '../../../../../handle-composition-result.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('set');
  command.description(`Sets a router compatibility version for the specified ${graphType}.`);
  command.argument('<name>', `The name of the ${graphType} for which to set the router compatibility version.`);
  command.requiredOption('-v, --version [number]', `The router compatibility version to set for the ${graphType}.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );

  command.action(async (name, options) => {
    const spinner = ora(`Attempting to set router compatibility version ${options.version}...`).start();

    const response = await opts.client.platform.setGraphRouterCompatibilityVersion(
      {
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        name,
        namespace: options.namespace,
        version: options.version,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (!response.response) {
      spinner.fail(`Failed to set router compatibility version for ${graphType} "${pc.bold(name)}".`);
      process.exitCode = 1;
      return;
    }

    if (response.response.code === EnumStatusCode.ERR_NOT_FOUND) {
      spinner.fail(`Failed to set router compatibility version for ${graphType} "${pc.bold(name)}".`);
      let message =
        `${pc.red(`No valid record could be found for ${graphType} "${pc.bold(name)}".`)}\n` +
        `Please check the name and namespace for the ${graphType} in Cosmo Studio.`;
      if (response.response?.details) {
        message += `\n${pc.red(pc.bold(response.response.details))}`;
      }
      program.error(message);
    }

    if (response.response.code === EnumStatusCode.ERR_BAD_REQUEST) {
      spinner.fail(`Failed to set router compatibility version for ${graphType} "${pc.bold(name)}".`);
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
      program.error(validVersionsTable.toString());
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
        subgraphCompositionBaseErrorMessage: `Composition of ${graphType} "${pc.bold(
          name,
        )}" using router compatibility version "${options.version}" was unsuccessful.`,
        subgraphCompositionDetailedErrorMessage:
          `Because composition was unsuccessful, the router compatibility version has been reverted to "${response.previousVersion}".` +
          `\n${pc.bold('Please check the errors below for details:')}`,
        deploymentErrorMessage:
          `The ${graphType} "${pc.bold(name)}" was successfully recomposed using router compatibility version "${
            options.version
          }".` +
          `\nHowever, the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\nConsequently, the router compatibility version has been reverted to "${response.previousVersion}".` +
          `\n${pc.bold('Please check the errors below for details:')}`,
        defaultErrorMessage: `Failed to set the router compatibility version for ${graphType} "${pc.bold(name)}" to "${
          options.version
        }".`,
        suppressWarnings: options.suppressWarnings,
      });
    } catch {
      program.error(versionsTable.toString());
    }
    console.log(versionsTable.toString());
  });

  return command;
};
