import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { baseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('publish');
  command.description(
    "Publishes a schema for the monograph on the control plane. Consider using the 'wgc monograph check' command to check for breaking changes before publishing.",
  );
  command.argument('<name>', 'The name of the monograph to push the schema to.');
  command.requiredOption('--schema <path-to-schema>', 'The schema file to upload to the monograph.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');

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

    const resp = await opts.client.platform.publishMonograph(
      {
        name,
        namespace: options.namespace,
        schema,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`Monograph '${name}' was updated successfully.`)));
    } else if (resp.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED) {
      const compositionErrorsTable = new Table({
        head: [pc.bold(pc.white('ERROR_MESSAGE'))],
        colWidths: [120],
        wordWrap: true,
      });

      console.log(
        pc.red(
          `We found composition errors.\nThe router will continue to work with the latest valid schema.\n${pc.bold(
            'Please check the errors below:',
          )}`,
        ),
      );
      for (const compositionError of resp.compositionErrors) {
        compositionErrorsTable.push([compositionError.message]);
      }
      // Don't exit here with 1 because the change was still applied
      console.log(compositionErrorsTable.toString());
    } else {
      console.log(pc.red(`Failed to update monograph ${pc.bold(name)}.`));
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
