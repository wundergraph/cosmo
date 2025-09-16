import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a federated grpc subgraph on the control plane.');
  command.argument(
    '<name>',
    'The name of the grpc subgraph to create. It is used to uniquely identify your grpc subgraph.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the grpc subgraph.');
  command.requiredOption(
    '-r, --routing-url <url>',
    'The routing URL of your subgraph. This is the url at which the subgraph will be accessible.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the subgraph. The labels are passed in the format <key>=<value> <key>=<value>.',
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the subgraph.');

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

    const spinner = ora('GRPC Subgraph is being created...').start();
    const resp = await opts.client.platform.createFederatedSubgraph(
      {
        name,
        namespace: options.namespace,
        labels: options.label ? options.label.map((label: string) => splitLabel(label)) : [],
        routingUrl: options.routingUrl,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
        type: SubgraphType.GRPC_SERVICE,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('GRPC subgraph was created successfully.');
    } else {
      spinner.fail('Failed to create grpc subgraph.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exitCode = 1;
      // eslint-disable-next-line no-useless-return
      return;
    }
  });

  return command;
};
