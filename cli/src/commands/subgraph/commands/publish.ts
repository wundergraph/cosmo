import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  parseGraphQLSubscriptionProtocol,
  parseGraphQLWebsocketSubprotocol,
  splitLabel,
} from '@wundergraph/cosmo-shared';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { validateSubscriptionProtocols } from '../../../utils.js';
import { websocketSubprotocolDescription } from '../../../constants.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('publish');
  command.description(
    "Publishes a subgraph on the control plane. If the subgraph doesn't exists, it will be created.\nIf the publication leads to composition errors, the errors will be visible in the Studio.\nThe router will continue to work with the latest valid schema.\nConsider using the 'wgc subgraph check' command to check for composition errors before publishing.",
  );
  command.argument(
    '<name>',
    'The name of the subgraph to push the schema to. It is usually in the format of <org>.<service.name> and is used to uniquely identify your subgraph.',
  );
  command.requiredOption('--schema <path-to-schema>', 'The schema file to upload to the subgraph.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing URL of the subgraph. This is the URL at which the subgraph will be accessible.' +
      ' This parameter is always ignored if the subgraph has already been created.' +
      ' Required if the subgraph is not an Event-Driven Graph.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the subgraph. The labels are passed in the format <key>=<value> <key>=<value>.' +
      ' This parameter is always ignored if the subgraph has already been created.',
    [],
  );
  command.option(
    '--subscription-url [url]',
    'The url used for subscriptions. If empty, it defaults to same url used for routing.' +
      ' This parameter is always ignored if the subgraph has already been created.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the subgraph. The supported protocols are ws, sse, and sse_post.' +
      ' This parameter is always ignored if the subgraph has already been created.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
  );
  command.option(
    '--websocket-subprotocol <protocol>',
    websocketSubprotocolDescription +
      ' This parameter is always ignored if the subgraph has already been created.' +
      ' Returns an error if the subgraph is an Event-Driven Graph.',
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
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');

  command.action(async (name, options) => {
    const schemaFile = resolve(options.schema);
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

    const spinner = ora('Subgraph is being published...').start();

    const resp = await opts.client.platform.publishFederatedSubgraph(
      {
        name,
        namespace: options.namespace,
        // Publish schema only
        schema,
        // Optional when subgraph does not exist yet
        routingUrl: options.routingUrl,
        subscriptionUrl: options.subscriptionUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        websocketSubprotocol: options.websocketSubprotocol
          ? parseGraphQLWebsocketSubprotocol(options.websocketSubprotocol)
          : undefined,
        labels: options.label.map((label: string) => splitLabel(label)),
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(resp?.hasChanged === false ? 'No new changes to publish.' : 'Subgraph published successfully.');
        if (resp.proposalMatchMessage) {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(resp.proposalMatchMessage));
        }

        break;
      }
      case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
        spinner.fail(`Failed to publish subgraph "${name}".`);
        console.log(pc.red(`Error: Proposal match failed`));
        console.log(pc.red(resp.proposalMatchMessage));
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('Subgraph published but with composition errors.');
        if (resp.proposalMatchMessage) {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(resp.proposalMatchMessage));
        }

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
          "Subgraph was published, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
        spinner.fail(`Failed to publish subgraph "${name}".`);
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
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
