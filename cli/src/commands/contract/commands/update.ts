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
  const command = new Command('update');
  command.description('Updates the tags of a contract.');
  command.argument('<name>', 'The name of the contract graph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the contract update.');
  command.option(
    '--include [tags...]',
    'Only schema elements with these tags will be included in the contract schema.',
  );
  command.option('--exclude [tags...]', 'Schema elements with these tags will be excluded from the contract schema.');
  command.action(async (name, options) => {
    const spinner = ora('Contract is being updated...').start();

    const resp = await opts.client.platform.updateContract(
      {
        name,
        namespace: options.namespace,
        includeTags: options.include,
        excludeTags: options.exclude,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Contract was updated successfully.');
        break;
      }
      default: {
        spinner.fail(`Failed to update contract.`);
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
