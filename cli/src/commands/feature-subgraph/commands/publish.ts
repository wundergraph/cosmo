import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { parseGraphQLSubscriptionProtocol, parseGraphQLWebsocketSubprotocol } from '@wundergraph/cosmo-shared';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { validateSubscriptionProtocols } from '../../../utils.js';
import { websocketSubprotocolDescription } from '../../../constants.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('publish');
  command.description(
    "Publishes a feature subgraph on the control plane. If the feature subgraph doesn't exists, it will be created.\nIf the publication leads to composition errors, the errors will be visible in the Studio.\nThe router will continue to work with the latest valid schema.",
  );
  command.argument(
    '<name>',
    'The name of the feature subgraph to push the schema to. It is usually in the format of <org>.<service.name> and is used to uniquely identify your feature subgraph.',
  );
  command.requiredOption('--schema <path-to-schema>', 'The schema file to upload to the feature subgraph.');
  command.option('-n, --namespace [string]', 'The namespace of the feature subgraph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing URL of the feature subgraph. This is the URL at which the feature subgraph will be accessible.' +
      ' This parameter is always ignored if the feature subgraph has already been created.',
  );
  command.option(
    '--subscription-url [url]',
    'The url used for subscriptions. If empty, it defaults to same url used for routing.' +
      ' This parameter is always ignored if the feature subgraph has already been created.',
  );
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the feature subgraph. The supported protocols are ws, sse, and sse_post.' +
      ' This parameter is always ignored if the feature subgraph has already been created.',
  );
  command.option(
    '--websocket-subprotocol <protocol>',
    websocketSubprotocolDescription +
      ' This parameter is always ignored if the feature subgraph has already been created.',
  );
  command.option(
    '--fail-on-composition-error',
    'If set, the command will fail if the composition of the federated graph fails.',
    false,
  );
  command.option(
    '--fail-on-admission-webhook-error',
    'If set, the command will fail if the admission webhook fails.',
    false,
  );
  command.option(
    '--subgraph <subgraph>',
    'The base subgraph name for which the feature subgraph is to be created' +
      ' This parameter is always ignored if the feature subgraph has already been created.',
  );

  command.action(async (name, options) => {
    const schemaFile = resolve(process.cwd(), options.schema);
    if (!existsSync(schemaFile)) {
      program.error(
        pc.red(
          pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
        ),
      );
    }

    const schemaBuffer = await readFile(schemaFile);
    const schema = new TextDecoder().decode(schemaBuffer);
    if (schema.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The schema file '${pc.bold(schemaFile)}' is empty. Please provide a valid schema.`)),
      );
    }

    validateSubscriptionProtocols({
      subscriptionProtocol: options.subscriptionProtocol,
      websocketSubprotocol: options.websocketSubprotocol,
    });

    const spinner = ora('Feature Subgraph is being published...').start();

    const resp = await opts.client.platform.publishFederatedSubgraph(
      {
        name,
        namespace: options.namespace,
        // Publish schema only
        schema,
        // Optional when feature subgraph does not exist yet
        routingUrl: options.routingUrl,
        subscriptionUrl: options.subscriptionUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        websocketSubprotocol: options.websocketSubprotocol
          ? parseGraphQLWebsocketSubprotocol(options.websocketSubprotocol)
          : undefined,
        labels: [],
        isFeatureSubgraph: true,
        baseSubgraphName: options.subgraph,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(
          resp?.hasChanged === false ? 'No new changes to publish.' : 'Feature subgraph published successfully.',
        );

        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('Feature subgraph published but with composition errors.');

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
            `We found composition errors, while composing the federated graph.\nThe router will continue to work with the latest valid schema.\n${pc.bold(
              'Please check the errors below:',
            )}`,
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

        if (options.failOnCompositionError) {
          program.error(pc.red(pc.bold('The command failed due to composition errors.')));
        }

        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "Feature subgraph was published, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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

        if (options.failOnAdmissionWebhookError) {
          program.error(pc.red(pc.bold('The command failed due to admission webhook errors.')));
        }

        break;
      }
      default: {
        spinner.fail(`Failed to publish feature subgraph "${name}".`);
        if (resp.response?.details) {
          program.error(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
