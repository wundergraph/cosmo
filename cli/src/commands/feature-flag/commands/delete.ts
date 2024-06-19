import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import ora from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a feature flag from the control plane.');
  command.argument('<name>', 'The name of the feature flag that will be deleted.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option('-f --force', 'Flag to force the deletion (skip confirmation).');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: 'Are you sure you want to delete this feature flag?',
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }

    const spinner = ora(`The feature flag "${name}" is being deleted...`).start();

    const resp = await opts.client.platform.deleteFeatureFlag(
      {
        featureFlagName: name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(`The feature flag "${name}" was deleted successfully.`);
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.fail(`The feature flag "${name}" was deleted but with composition errors.`);

        const compositionErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        console.log(
          pc.red(
            `There were composition errors when composing at least one federated graph.` +
            `\nThe router will continue to work with the latest valid schema.` +
            `\n${pc.bold('Please check the errors below:')}`,
          ),
        );
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(compositionErrorsTable.toString());
        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          `The feature flag "${name}" was deleted, but the updated composition hasn't been deployed,` +
          ` so it's not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
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
        spinner.fail(`Failed to delete the feature flag "${name}".`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
