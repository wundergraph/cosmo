import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PartialMessage } from '@bufbuild/protobuf';
import { GitInfo } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { useGitHub, verifyGitHubIntegration } from '../../../github.js';
import { handleCheckResult } from '../../../handle-check-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('check');
  command.description('Checks for breaking changes and composition errors with all connected federated graphs.');
  command.argument('<name>', 'The name of the subgraph on which the check operation is to be performed.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option('--schema <path-to-schema>', 'The path of the new schema file.');
  command.option('--delete', 'Run checks in case the subgraph is deleted.');

  command.action(async (name, options) => {
    let schemaFile;

    if (!options.schema && !options.delete) {
      program.error("required option '--schema <path-to-schema>' or '--delete' not specified.");
    }

    if (options.schema) {
      schemaFile = resolve(process.cwd(), options.schema);
      if (!existsSync(schemaFile)) {
        program.error(
          pc.red(
            pc.bold(`The readme file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
          ),
        );
      }
    }

    const { gitInfo, ignoreErrorsDueToGitHubIntegration } = await verifyGitHubIntegration(opts.client);

    // submit an empty schema in case of a delete check
    const schema = schemaFile ? await readFile(schemaFile) : Buffer.from('');

    const resp = await opts.client.platform.checkSubgraphSchema(
      {
        subgraphName: name,
        namespace: options.namespace,
        schema,
        gitInfo,
        delete: options.delete,
      },
      {
        headers: baseHeaders,
      },
    );

    const success = handleCheckResult(resp);

    if (!success && !ignoreErrorsDueToGitHubIntegration) {
      process.exit(1);
    }
  });

  return command;
};
