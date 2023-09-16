import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Table from 'cli-table3';
import { Command } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const schemaPush = new Command('publish');
  schemaPush.description('Publishes a subgraph on the control plane.');
  schemaPush.argument(
    '<name>',
    'The name of the subgraph to push the schema to. It is usually in the format of <org>.<service.name> and is used to uniquely identify your subgraph.',
  );
  schemaPush.requiredOption('--schema <path-to-schema>', 'The schema file to upload to the subgraph.');
  schemaPush.action(async (name, options) => {
    const schemaFile = resolve(process.cwd(), options.schema);
    if (!existsSync(schemaFile)) {
      console.log(
        pc.red(
          pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
        ),
      );
      return;
    }

    const resp = await opts.client.platform.publishFederatedSubgraph(
      {
        name,
        schema: await readFile(schemaFile),
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.dim(pc.green(`Subgraph '${name}' was updated successfully.`)));
    } else if (resp.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED) {
      console.log(pc.dim(pc.green(`Subgraph '${name}' was updated successfully.`)));

      const compositionErrorsTable = new Table({
        head: [pc.bold(pc.white('FEDERATED_GRAPH_NAME')), pc.bold(pc.white('ERROR_MESSAGE'))],
        colWidths: [30, 120],
        wordWrap: true,
      });

      console.log(
        pc.yellow(
          'But we found composition errors, while composing the federated graph.\nThe graph will not be updated until the errors are fixed. Please check the errors below:',
        ),
      );
      for (const compositionError of resp.compositionErrors) {
        compositionErrorsTable.push([compositionError.federatedGraphName, compositionError.message]);
      }
      // Don't exit here with 1 because the change was still applied
      console.log(compositionErrorsTable.toString());
    } else {
      console.log(`Failed to update subgraph '${pc.bold(name)}'.`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return schemaPush;
};
