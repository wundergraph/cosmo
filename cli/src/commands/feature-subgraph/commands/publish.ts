import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { parseGraphQLSubscriptionProtocol, parseGraphQLWebsocketSubprotocol } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { websocketSubprotocolDescription } from '../../../constants.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleCompositionResult } from '../../../handle-composition-result.js';
import { validateSubscriptionProtocols } from '../../../utils.js';
import { getBaseHeaders } from '../../../core/config.js';

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
  command.option('-r, --raw', 'Prints to the console in json format instead of table');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );

  command.action(async (name, options) => {
    const schemaFile = resolve(options.schema);
    const shouldOutputJson = options.json || options.raw;
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

    const spinner = ora('Feature Subgraph is being published...');
    if (!shouldOutputJson) {
      spinner.start();
    }

    const resp = await opts.client.platform.publishFederatedSubgraph(
      {
        baseSubgraphName: options.subgraph,
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        isFeatureSubgraph: true,
        labels: [],
        name,
        namespace: options.namespace,
        // Publish schema only
        // Optional when feature subgraph does not exist yet
        routingUrl: options.routingUrl,
        schema,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        subscriptionUrl: options.subscriptionUrl,
        websocketSubprotocol: options.websocketSubprotocol
          ? parseGraphQLWebsocketSubprotocol(options.websocketSubprotocol)
          : undefined,
        // passing Standard type to the backend, because the users have to use the 'wgc router plugin publish' command to publish the plugin
        type: SubgraphType.STANDARD,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    try {
      handleCompositionResult({
        responseCode: resp.response?.code,
        responseDetails: resp.response?.details,
        compositionErrors: resp.compositionErrors,
        compositionWarnings: resp.compositionWarnings,
        deploymentErrors: resp.deploymentErrors,
        spinner,
        successMessage:
          resp?.hasChanged === false ? 'No new changes to publish.' : 'Feature subgraph published successfully.',
        subgraphCompositionBaseErrorMessage: 'Feature subgraph published but with composition errors.',
        subgraphCompositionDetailedErrorMessage: `We found composition errors, while composing the federated graph.\nThe router will continue to work with the latest valid schema.\n${pc.bold(
          'Please check the errors below:',
        )}`,
        deploymentErrorMessage: `Feature subgraph was published, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.`,
        defaultErrorMessage: `Failed to publish feature subgraph "${name}".`,
        shouldOutputJson: options.json,
        suppressWarnings: options.suppressWarnings,
        failOnCompositionError: options.failOnCompositionError,
        failOnAdmissionWebhookError: options.failOnAdmissionWebhookError,
        failOnCompositionErrorMessage: `The command failed due to composition errors.`,
        failOnAdmissionWebhookErrorMessage: `The command failed due to admission webhook errors.`,
      });
    } catch {
      process.exitCode = 1;
      // eslint-disable-next-line no-useless-return
      return;
    }
  });

  return command;
};
