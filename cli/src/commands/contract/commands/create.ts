import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import ora from 'ora';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a contract graph from the provided source graph.');
  command.argument('<name>', 'The name of the contract graph to create.');
  command.option('-n, --namespace [string]', 'The namespace of the contract graph.');
  command.requiredOption('--source [string]', 'The source graph from which you want to create the contract.');
  command.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  command.option(
    '--include [tags...]',
    'Only schema elements with these tags will be included in the contract schema.',
  );
  command.option('--exclude [tags...]', 'Schema elements with these tags will be excluded from the contract schema.');
  command.option(
    '--admission-webhook-url <url>',
    'The admission webhook url. This is the url that the controlplane will use to implement admission control for the contract graph.',
    [],
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the contract.');
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

    const spinner = ora('Contract is being created...').start();

    const resp = await opts.client.platform.createContract(
      {
        name,
        namespace: options.namespace,
        sourceGraphName: options.source,
        includeTags: options.include,
        excludeTags: options.exclude,
        routingUrl: options.routingUrl,
        admissionWebhookUrl: options.admissionWebhookUrl,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Contract graph was created successfully.');
        break;
      }
      default: {
        spinner.fail(`Failed to create contract graph.`);
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
