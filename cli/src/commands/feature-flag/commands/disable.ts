import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import Table from 'cli-table3';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleFeatureFlagResult } from '../../../handle-feature-flag-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('disable');
  command.description('Disables a feature flag on the control plane.');
  command.argument('<name>', 'The name of the feature flag to disable.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');

  command.action(async (name, options) => {
    const spinner = ora(`The feature flag "${name}" is being disabled...`).start();
    const resp = await opts.client.platform.enableFeatureFlag(
      {
        name,
        namespace: options.namespace,
        enabled: false,
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
        successMessage:
          resp?.hasChanged === false
            ? `The feature flag "${name}" is already disabled.`
            : `The feature flag "${name}" was disabled successfully.`,
        subgraphCompositionBaseErrorMessage: `The feature flag "${name}" was disabled but with composition errors.`,
        subgraphCompositionDetailedErrorMessage:
          `There were composition errors when composing at least one federated graph related to the` +
          ` disabling of feature flag "${name}".` +
          `.\nThe federated graphs will not be updated until the errors are fixed.` +
          `\n${pc.bold('Please check the errors below:')}`,
        deploymentErrorMessage:
          `The feature flag "${name}" was disabled, but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to disable the feature flag "${name}".`,
        suppressWarnings: options.suppressWarnings,
      });
    } catch {
      process.exit(1);
    }
  });

  return command;
};
