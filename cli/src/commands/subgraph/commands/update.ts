import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  parseGraphQLSubscriptionProtocol,
  parseGraphQLWebsocketSubprotocol,
  splitLabel,
} from '@wundergraph/cosmo-shared';
import { resolve } from 'pathe';
import ora from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { validateSubscriptionProtocols } from '../../../utils.js';
import { websocketSubprotocolDescription } from '../../../constants.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates a subgraph on the control plane.');
  command.argument('<name>', 'The name of the subgraph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing URL of the subgraph. This is the URL at which the subgraph will be accessible.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the subgraph. The labels are passed in the format <key>=<value> <key>=<value>. This will overwrite existing labels.',
  );
  command.option(
    '--unset-labels',
    'This will remove all labels. It will not add new labels if both this and --labels option is passed.',
  );
  command.option(
    '--subscription-url <url>',
    'The url used for subscriptions. If empty, it defaults to same url used for routing.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the subgraph. The supported protocols are ws, sse, and sse_post.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option(
    '--websocket-subprotocol <protocol>',
    websocketSubprotocolDescription + ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the subgraph.');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );

  command.action(async (name, options) => {
    let readmeFile;
    if (options.readme) {
      readmeFile = resolve(options.readme);
      if (!existsSync(readmeFile)) {
        program.error(
          pc.red(
            pc.bold(`The readme file '${pc.bold(readmeFile)}' does not exist. Please check the path and try again.`),
          ),
        );
      }
    }

    validateSubscriptionProtocols({
      subscriptionProtocol: options.subscriptionProtocol,
      websocketSubprotocol: options.websocketSubprotocol,
    });

    const spinner = ora(`The subgraph "${name}" is being updated...`).start();
    const resp = await opts.client.platform.updateSubgraph(
      {
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        labels:
          options.label?.map?.((label: string) => {
            const { key, value } = splitLabel(label);
            return {
              key,
              value,
            };
          }) ?? [],
        name,
        namespace: options.namespace,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
        routingUrl: options.routingUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        subscriptionUrl: options.subscriptionUrl,
        unsetLabels: options.unsetLabels,
        websocketSubprotocol: options.websocketSubprotocol
          ? parseGraphQLWebsocketSubprotocol(options.websocketSubprotocol)
          : undefined,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(`The subgraph "${name}" was updated successfully.`);

        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn(`The subgraph "${name}" was updated but with composition errors.`);

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
              ` subgraph "${name}".\nThe router will continue to work with the latest valid schema.` +
              `\n${pc.bold('Please check the errors below:')}`,
          ),
        );
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.featureFlag,
            compositionError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(compositionErrorsTable.toString());

        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          `The subgraph "${name}" was updated, but the updated composition could not be deployed.` +
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
        spinner.fail(`Failed to update subgraph "${name}".`);
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
