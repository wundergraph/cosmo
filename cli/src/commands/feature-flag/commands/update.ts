import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleFeatureFlagResult } from '../../../handle-feature-flag-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates a feature flag group on the control plane.');
  command.argument('<name>', 'The name of the feature flag to update.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option(
    '--label [labels...]',
    'The labels to apply to the feature flag. The labels are passed in the format <key>=<value> <key>=<value>.',
  );
  command.option(
    '--unset-labels',
    'This will remove all labels. It will not add new labels if both this and --labels option is passed.',
  );
  command.option(
    '--fs, --feature-subgraphs <featureSubgraphs...>',
    'The names of the feature subgraphs that compose the feature flag.' +
      ' These feature subgraphs will replace the ones stored.' +
      ' The feature subgraphs are passed in the format <featureSubgraph1> <featureSubgraph2> <featureSubgraph3>.' +
      ' The feature flag must contain at least one feature subgraph.',
  );
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.action(async (name, options) => {
    if (options.featureGraphs && options.featureSubgraphs.length === 0) {
      program.error(
        pc.red(
          pc.bold(
            `The feature flag must contain at least one feature subgraph.` +
              ` Please check the feature subgraphs and try again.`,
          ),
        ),
      );
    }

    const spinner = ora(`The feature flag "${name}" is being updated...`);
    if (!options.json) {
      spinner.start();
    }
    const resp = await opts.client.platform.updateFeatureFlag(
      {
        name,
        namespace: options.namespace,
        labels: options.label ? options.label.map((label: string) => splitLabel(label)) : [],
        featureSubgraphNames: options.featureSubgraphs,
        unsetLabels: options.unsetLabels,
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
        successMessage: `The feature flag "${name}" was updated successfully.`,
        subgraphCompositionBaseErrorMessage: `The feature flag "${name}" was updated but with composition errors.`,
        subgraphCompositionDetailedErrorMessage:
          `There were composition errors when composing at least one federated graph related to the` +
          ` updating of feature flag "${name}".` +
          `.\nThe federated graphs will not be updated until the errors are fixed.` +
          `\n${pc.bold('Please check the errors below:')}`,
        deploymentErrorMessage:
          `The feature flag "${name}" was updated, but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to update the feature flag "${name}".`,
        shouldOutputJson: options.json,
      });
    } catch {
      process.exit(1);
    }
  });

  return command;
};
