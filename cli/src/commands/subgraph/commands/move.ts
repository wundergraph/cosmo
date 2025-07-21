import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command } from 'commander';
import pc from 'picocolors';
import ora from 'ora';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('move');
  command.description('Moves the subgraph from one namespace to another.');
  command.argument('<name>', 'The name of the subgraph to move.');
  command.requiredOption('-n, --namespace [string]', 'The namespace of the subgraph');
  command.requiredOption('-t, --to [string]', 'The new namespace of the subgraph.');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );

  command.action(async (name, options) => {
    const spinner = ora('Subgraph is being moved...').start();
    const resp = await opts.client.platform.moveSubgraph(
      {
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        name,
        namespace: options.namespace,
        newNamespace: options.to,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Subgraph has been moved successfully.');

        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('Subgraph has been moved but with composition errors.');

        const compositionErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('FEATURE_FLAG')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 30, 120],
          wordWrap: true,
        });

        console.log(
          pc.yellow(
            'But we found composition errors, while composing the federated graphs.\nThe graphs will not be updated until the errors are fixed. Please check the errors below:',
          ),
        );
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.featureFlag || '-',
            compositionError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(compositionErrorsTable.toString());

        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "The Subgraph was moved, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
        );

        const deploymentErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        for (const deploymentError of resp.deploymentErrors) {
          deploymentErrorsTable.push([
            deploymentError.federatedGraphName,
            deploymentError.namespace,
            deploymentError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(deploymentErrorsTable.toString());

        break;
      }
      default: {
        spinner.fail('Failed to move federated graph.');
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
        }
        process.exitCode = 1;
        return;
      }
    }

    if (!options.suppressWarnings && resp.compositionWarnings.length > 0) {
      const compositionWarningsTable = new Table({
        head: [
          pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
          pc.bold(pc.white('NAMESPACE')),
          pc.bold(pc.white('FEATURE_FLAG')),
          pc.bold(pc.white('WARNING_MESSAGE')),
        ],
        colWidths: [30, 30, 30, 120],
        wordWrap: true,
      });

      console.log(pc.yellow(`The following warnings were produced while composing the federated graph:`));
      for (const compositionWarning of resp.compositionWarnings) {
        compositionWarningsTable.push([
          compositionWarning.federatedGraphName,
          compositionWarning.namespace,
          compositionWarning.featureFlag || '-',
          compositionWarning.message,
        ]);
      }
      console.log(compositionWarningsTable.toString());
    }
  });

  return command;
};
