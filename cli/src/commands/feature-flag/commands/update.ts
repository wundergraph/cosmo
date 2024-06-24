import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import Table from 'cli-table3';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

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
    '--fs, --feature-subgraphs <featureSubgraphs...>',
    'The names of the feature subgraphs that compose the feature flag.' +
      ' These feature subgraphs will replace the ones stored.' +
      ' The feature subgraphs are passed in the format <featureSubgraph1> <featureSubgraph2> <featureSubgraph3>.' +
      ' The feature flag must contain at least one feature subgraph.',
  );
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

    const spinner = ora(`The feature flag "${name}" is being updated...`).start();
    const resp = await opts.client.platform.updateFeatureFlag(
      {
        name,
        namespace: options.namespace,
        labels: options.label ? options.label.map((label: string) => splitLabel(label)) : [],
        featureSubgraphNames: options.featureSubgraphs,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(`The feature flag "${name}" was updated successfully.`);
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn(`The feature flag "${name}" was updated but with composition errors.`);

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
            `There were composition errors when composing at least one federated graph related to the` +
              ` updating of feature flag "${name}".` +
              `.\nThe federated graphs will not be updated until the errors are fixed.` +
              `\n${pc.bold('Please check the errors below:')}`,
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
          `The feature flag "${name}" was updated, but the updated composition could not be deployed.` +
            `\nThis means the updated composition is not accessible to the router.` +
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
        spinner.fail(`Failed to update feature flag "${name}".`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
