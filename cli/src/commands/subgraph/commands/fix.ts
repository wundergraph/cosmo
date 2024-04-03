import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Command, program } from 'commander';
import { join } from 'pathe';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import logSymbols from 'log-symbols';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('fix');
  command.description(
    'Checks for composition errors with all connected federated graphs and tries to fix them.\n\n' +
      'If you do not want to override the original schema file,\n' +
      'you can specify the --out-schema option.',
  );
  command.argument('<name>', 'The name of the subgraph on which the check operation is to be performed.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.requiredOption('--schema <path-to-schema>', 'The path of the new schema file.');
  command.option('--out-schema <path-to-out-schema>', 'The path where the fixed schema file should be written.');

  command.action(async (name, options) => {
    const schemaFile = join(process.cwd(), options.schema);
    if (!existsSync(schemaFile)) {
      program.error(
        pc.red(
          pc.bold(`The schema file '${pc.bold(options.schema)}' does not exist. Please check the path and try again.`),
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

    const resp = await opts.client.platform.fixSubgraphSchema(
      {
        subgraphName: name,
        namespace: options.namespace,
        schema,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      console.log('\nFailed to perform the fix operation.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      console.log(logSymbols.error + pc.red(' Schema fix failed.'));
      process.exit(1);
    }

    if (!resp.modified) {
      console.log(logSymbols.success + pc.green(' No fix required.'));
      return;
    }

    if (options.outSchema) {
      await writeFile(join(process.cwd(), options.outSchema), resp.schema);
      console.log(logSymbols.success + pc.green(` Fixed schema written to ${options.outSchema}.`));
      return;
    }

    await writeFile(schemaFile, resp.schema);
    console.log(logSymbols.success + pc.green(` Fixed schema written to ${options.schema}.`));
  });

  return command;
};
