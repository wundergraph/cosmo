import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { parseGraphQLSubscriptionProtocol } from '@wundergraph/cosmo-shared';
import ora from 'ora';
import { baseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a monograph on the control plane.');
  command.argument('<name>', 'The name of the graph to create. It is used to uniquely identify your graph.');
  command.option('-n, --namespace [string]', 'The namespace of the graph.');
  command.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  command.requiredOption('-u, --graph-url <url>', 'The url of your GraphQL server that is accessible from the router.');
  command.option('--subscription-url [url]', 'The url used for subscriptions. If empty, it defaults to graph url.');
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the graph. The supported protocols are ws, sse, and sse_post.',
  );
  command.option(
    '--admission-webhook-url <url>',
    'The admission webhook url. This is the url that the controlplane will use to implement admission control for the monograph. This is optional.',
    [],
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the graph.');
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

    const spinner = ora('Federated Graph is being created...').start();

    const resp = await opts.client.platform.createMonograph(
      {
        name,
        namespace: options.namespace,
        routingUrl: options.routingUrl,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
        graphUrl: options.graphUrl,
        subscriptionUrl: options.subscriptionUrl === true ? '' : options.subscriptionUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        admissionWebhookURL: options.admissionWebhookUrl,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('Monograph was created successfully.');
    } else {
      spinner.fail(`Failed to create monograph.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
