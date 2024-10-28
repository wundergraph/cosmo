import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import ora from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { handleFeatureFlagResult } from '../../../handle-feature-flag-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a feature flag from the control plane.');
  command.argument('<name>', 'The name of the feature flag to delete.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option('-f --force', 'Flag to force the deletion (skip confirmation).');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: `Are you sure you want to delete the feature flag "${name}"?`,
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exit(1);
      }
    }

    const spinner = ora(`The feature flag "${name}" is being deleted...`).start();

    const resp = await opts.client.platform.deleteFeatureFlag(
      {
        name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    try {
      handleFeatureFlagResult({
        responseCode: resp.response?.code,
        responseDetails: resp.response?.details,
        compositionErrors: resp.compositionErrors,
        compositionWarnings: resp.compositionWarnings,
        deploymentErrors: resp.deploymentErrors,
        spinner,
        successMessage: `The feature flag "${name}" was deleted successfully.`,
        subgraphCompositionBaseErrorMessage: `The feature flag "${name}" was deleted but with composition errors.`,
        subgraphCompositionDetailedErrorMessage:
          `There were composition errors when composing at least one federated graph related to the` +
          ` deletion of feature flag "${name}".\nThe router will continue to work with the latest valid schema.` +
          `\n${pc.bold('Please check the errors below:')}`,
        deploymentErrorMessage:
          `The feature flag "${name}" was deleted, but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to delete the feature flag "${name}".`,
        suppressWarnings: options.suppressWarnings,
      });
    } catch {
      process.exit(1);
    }
  });

  return command;
};
