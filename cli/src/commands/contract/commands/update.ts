import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command } from 'commander';
import pc from 'picocolors';
import ora from 'ora';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates the tags of a contract.');
  command.argument('<name>', 'The name of the contract graph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the contract update.');
  command.option('--exclude [tags...]', 'Schema elements with these tags will be excluded from the contract schema.');
  command.action(async (name, options) => {
    const spinner = ora('Contract is being updated...').start();

    const resp = await opts.client.platform.updateContract(
      {
        name,
        namespace: options.namespace,
        excludeTags: options.exclude,
      },
      {
        headers: getBaseHeaders(),
      },
    );

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

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Contract was updated successfully.');
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.fail('Contract updated but with composition errors.');

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

        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.featureFlag || '-',
            compositionError.message,
          ]);
        }
        console.log(compositionErrorsTable.toString());
        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "The contract was updated, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
        console.log(deploymentErrorsTable.toString());
        break;
      }
      default: {
        spinner.fail(`Failed to update contract.`);
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }

    if (resp.compositionWarnings.length > 0) {
      console.log(pc.yellow(`We found these composition warnings, while composing the federated graph.`));
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
