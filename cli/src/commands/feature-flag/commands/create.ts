import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleFeatureFlagResult } from '../../../handle-feature-flag-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description(
    'Creates a feature flag on the control plane. A feature flag must contain one or more feature subgraphs.',
  );
  command.argument('<name>', 'The name of the feature flag to create.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option(
    '--label [labels...]',
    'The labels to apply to the feature flag. The labels are passed in the format <key>=<value> <key>=<value>.',
  );
  command.requiredOption(
    '--fs, --feature-subgraphs <featureSubgraphs...>',
    'The names of the feature subgraphs that will form the feature flag.' +
      ' The feature subgraphs are passed in the format <featureSubgraph1> <featureSubgraph2> <featureSubgraph3>.' +
      ' The feature flag must have at least one feature subgraph.',
  );
  command.option(
    '-e, --enabled',
    'Flag that if included will enable the feature flag upon creation.' +
      ' A new feature flag is disabled by default to prevent accidental compositions.',
  );
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.action(async (name, options) => {
    const spinner = ora('The feature flag is being created...');
    if (!options.json) {
      spinner.start();
    }
    const resp = await opts.client.platform.createFeatureFlag(
      {
        name,
        namespace: options.namespace,
        labels: options.label ? options.label.map((label: string) => splitLabel(label)) : [],
        featureSubgraphNames: options.featureSubgraphs,
        isEnabled: !!options.enabled,
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
        deploymentErrors: resp.deploymentErrors,
        spinner,
        successMessage: `The feature flag "${name}" was created successfully. ${
          options.enabled
            ? ''
            : `To enable it, use the "wgc feature-flag enable" command or pass the "--enabled" flag when creating it.`
        }`,
        subgraphCompositionBaseErrorMessage: `The feature flag "${name}" was created but with composition errors.`,
        subgraphCompositionDetailedErrorMessage:
          `There were composition errors when composing at least one federated graph related to the` +
          ` creation of feature flag "${name}"` +
          `.\nThe federated graphs will not be updated until the errors are fixed.` +
          `\n${pc.bold('Please check the errors below:')}`,
        deploymentErrorMessage:
          `The feature flag "${name}" was created, but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to create the feature flag "${name}".`,
        shouldOutputJson: options.json,
      });
    } catch {
      process.exit(1);
    }
  });

  return command;
};
