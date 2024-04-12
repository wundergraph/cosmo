import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { splitLabel, parseGraphQLSubscriptionProtocol, isValidSubscriptionProtocol } from '@wundergraph/cosmo-shared';
import { resolve } from 'pathe';
import ora from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates a subgraph on the control plane.');
  command.argument('<name>', 'The name of the subgraph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing url of your subgraph. This is the url that the subgraph will be accessible at.',
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
    'The url used for subscriptions. If empty, it defaults to same url used for routing.',
  );
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the subgraph. The supported protocols are ws, sse, and sse_post.',
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the subgraph.');

  command.action(async (name, options) => {
    let readmeFile;
    if (options.readme) {
      readmeFile = resolve(process.cwd(), options.readme);
      if (!existsSync(readmeFile)) {
        program.error(
          pc.red(
            pc.bold(`The readme file '${pc.bold(readmeFile)}' does not exist. Please check the path and try again.`),
          ),
        );
      }
    }

    if (options.subscriptionProtocol && !isValidSubscriptionProtocol(options.subscriptionProtocol)) {
      program.error(
        pc.red(
          pc.bold(
            `The subscription protocol '${pc.bold(
              options.subscriptionProtocol,
            )}' is not valid. Please use one of the following: sse, sse_post, ws.`,
          ),
        ),
      );
    }

    const spinner = ora('Subgraph is being updated...').start();
    const resp = await opts.client.platform.updateSubgraph(
      {
        name,
        namespace: options.namespace,
        labels:
          options.label?.map?.((label: string) => {
            const { key, value } = splitLabel(label);
            return {
              key,
              value,
            };
          }) ?? [],
        unsetLabels: options.unsetLabels,
        subscriptionUrl: options.subscriptionUrl,
        routingUrl: options.routingUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Subgraph was updated successfully.');

        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('Subgraph was updated but with composition errors.');

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
            `We found composition errors, while composing the federated graph.\nThe router will continue to work with the latest valid schema.\n${pc.bold(
              'Please check the errors below:',
            )}`,
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
          "Subgraph was updated, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
        spinner.fail(`Failed to update subgraph.`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
