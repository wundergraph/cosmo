import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import Table from 'cli-table3';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('enable');
  command.description('Enables a feature flag on the control plane.');
  command.argument('<name>', 'The name of the feature flag to enable.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');

  command.action(async (name, options) => {
    const spinner = ora('Feature flag is being enabled...').start();
    const resp = await opts.client.platform.enableFeatureFlag(
      {
        featureFlagName: name,
        namespace: options.namespace,
        enabled: true,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Feature flag was enabled successfully.');
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('Federated Graph was enabled but with composition errors.');

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
            'But we found composition errors, while composing the federated graph.\nThe graph will not be updated until the errors are fixed. Please check the errors below:',
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
          "The Federated Graph was set up, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
         spinner.fail('Failed to enable feature flag.');
         if (resp.response?.details) {
           console.log(pc.red(pc.bold(resp.response?.details)));
         }
         process.exit(1);
      }
    }
  });

  return command;
};
