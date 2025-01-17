import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { resolve } from 'pathe';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('push');
  command.description('Pushes new cache warmer operations to the registry');
  command.argument(
    '<graph_name>',
    'The name of the federated graph or monograph on which the check operations are stored.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  command.option(
    '-o, --operation-name <operation-name>',
    'The name of the operation. Only needed when working with multi-operation document.',
  );
  command.option(
    '-p, --persisted-operation-id <persisted-operation-id>',
    'The id of the persisted operation to be pushed.',
  );
  command.option(
    '-f, --file <file>',
    'The file with the operation to push - supports .graphql, .gql. If both the file and the persisted operation id are provided, the persisted operation id will be used.',
  );

  command.action(async (name, options) => {
    if (!options.file && !options.persistedOperationId) {
      command.error(pc.red('No operation file or the id of persisted operation provided'));
    }

    if (options.persistedOperationId && options.file) {
      command.error(pc.red('Only the persisted operation id or the file can be specified'));
    }

    let operation: string | undefined;
    if (options.file) {
      const operationFile = resolve(options.file);
      if (!existsSync(operationFile)) {
        program.error(
          pc.red(
            pc.bold(
              `The operation file '${pc.bold(operationFile)}' does not exist. Please check the path and try again.`,
            ),
          ),
        );
      }

      const schemaBuffer = await readFile(operationFile);
      operation = new TextDecoder().decode(schemaBuffer);
      if (operation.trim().length === 0) {
        program.error(
          pc.red(pc.bold(`The schema file '${pc.bold(operationFile)}' is empty. Please provide a valid operation.`)),
        );
      }
    }

    const result = await opts.client.platform.pushCacheWarmerOperation(
      {
        federatedGraphName: name,
        operationContent: operation,
        operationName: options.operationName,
        operationPersistedId: options.persistedOperationId,
        namespace: options.namespace,
      },
      { headers: getBaseHeaders() },
    );

    if (result.response?.code === EnumStatusCode.OK) {
      console.log(pc.green(`The cache warmer operation was pushed successfully.`));
    } else {
      console.log(pc.red(`Failed to push the cache warmer operation. Please try again.`));
      if (result.response?.details) {
        console.error(pc.red(pc.bold(result.response?.details)));
      }
      process.exit(1);
    }
  });
  return command;
};
