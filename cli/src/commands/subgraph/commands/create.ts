import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  parseGraphQLSubscriptionProtocol,
  parseGraphQLWebsocketSubprotocol,
  splitLabel,
} from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { validateSubscriptionProtocols } from '../../../utils.js';
import { websocketSubprotocolDescription } from '../../../constants.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a federated subgraph on the control plane.');
  command.argument(
    '<name>',
    'The name of the subgraph to create. It is usually in the format of <org>.<service.name> and is used to uniquely identify your subgraph.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing URL of your subgraph. This is the url at which the subgraph will be accessible.' +
      ' Required unless the event-driven-graph flag is set.' +
      ' Returns an error if the event-driven-graph flag is set.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the subgraph. The labels are passed in the format <key>=<value> <key>=<value>.',
  );
  command.option(
    '--subscription-url [url]',
    'The URL used for subscriptions. If empty, it defaults to same url used for routing.' +
      ' Returns an error if the event-driven-graph flag is set.',
  );
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the subgraph. The supported protocols are ws, sse, and sse_post.' +
      ' Returns an error if the event-driven-graph flag is set.',
  );
  command.option(
    '--websocket-subprotocol <protocol>',
    websocketSubprotocolDescription + ' Returns an error if the event-driven-graph flag is set.',
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the subgraph.');
  command.option(
    '--edg, --event-driven-graph',
    'Set whether the subgraph is an Event-Driven Graph (EDG).' +
      ' Errors will be returned for the inclusion of most other parameters if the subgraph is an Event-Driven Graph.',
  );
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

    validateSubscriptionProtocols({
      subscriptionProtocol: options.subscriptionProtocol,
      websocketSubprotocol: options.websocketSubprotocol,
    });

    const spinner = ora('Subgraph is being created...').start();
    const resp = await opts.client.platform.createFederatedSubgraph(
      {
        name,
        namespace: options.namespace,
        labels: options.label ? options.label.map((label: string) => splitLabel(label)) : [],
        routingUrl: options.routingUrl,
        // If the argument is provided but the URL is not, clear it
        subscriptionUrl: options.subscriptionUrl === true ? '' : options.subscriptionUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        websocketSubprotocol: options.websocketSubprotocol
          ? parseGraphQLWebsocketSubprotocol(options.websocketSubprotocol)
          : undefined,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
        isEventDrivenGraph: !!options.eventDrivenGraph,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('Subgraph was created successfully.');
    } else {
      spinner.fail('Failed to create subgraph.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
