import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { resolve } from 'pathe';
import { parseGraphQLSubscriptionProtocol } from '@wundergraph/cosmo-shared';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { baseHeaders } from '../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates a monograph on the control plane.');
  command.argument('<name>', 'The name of the monograph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  command.option(
    '-u, --graph-url <url>',
    'The url of your graph. This is the url that the router will communicate to.',
  );
  command.option(
    '--subscription-url [url]',
    'The url used for subscriptions. If empty, it defaults to same url used for routing.',
  );
  command.option(
    '--subscription-protocol <protocol>',
    'The protocol to use when subscribing to the graph. The supported protocols are ws, sse, and sse_post.',
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

    const resp = await opts.client.platform.updateMonograph(
      {
        name,
        namespace: options.namespace,
        routingUrl: options.routingUrl,
        graphUrl: options.graphUrl,
        subscriptionUrl: options.subscriptionUrl === true ? '' : options.subscriptionUrl,
        subscriptionProtocol: options.subscriptionProtocol
          ? parseGraphQLSubscriptionProtocol(options.subscriptionProtocol)
          : undefined,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`The monograph '${name}' was updated.`)));
    } else {
      console.log(`Failed to update monograph ${pc.bold(name)}.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
