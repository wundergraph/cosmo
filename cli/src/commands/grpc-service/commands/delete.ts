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
  command.description('Deletes a gRPC subgraph on the control plane.');
  command.argument('<name>', 'The name of the gRPC subgraph to delete.');
  command.option('-n, --namespace [string]', 'The namespace of the gRPC subgraph.');
  command.option('-f, --force', 'Flag to force the deletion (skip confirmation).');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.action(async (name, options) => {
    if (!options.force) {
      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: `Are you sure you want to delete the gRPC subgraph "${name}"?`,
      });
      if (!deletionConfirmed.confirmDeletion) {
        process.exitCode = 1;
        return;
      }
    }

    const spinner = ora(`The gRPC subgraph "${name}" is being deleted...`).start();

    const resp = await opts.client.platform.deleteFederatedSubgraph(
      {
        subgraphName: name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(`The gRPC subgraph "${name}" was deleted successfully.`);
        if (resp.proposalMatchMessage) {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(resp.proposalMatchMessage));
        }
        break;
      }
      case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
        spinner.fail(`Failed to delete gRPC subgraph "${name}".`);
        console.log(pc.red(`Error: Proposal match failed`));
        console.log(pc.red(resp.proposalMatchMessage));
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.fail(`The gRPC subgraph "${name}" was deleted but with composition errors.`);

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
          pc.red(
            `There were composition errors when composing at least one federated graph related to the` +
              ` gRPC subgraph "${name}".\nThe router will continue to work with the latest valid schema.` +
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
          `The gRPC subgraph "${name}" was deleted, but the updated composition could not be deployed.` +
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
        spinner.fail(`Failed to delete the gRPC subgraph "${name}".`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
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
