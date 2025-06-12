import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { VCSContext } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { config, getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { verifyGitHubIntegration } from '../../../github.js';
import { handleCheckResult } from '../../../handle-check-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('check');
  command.description('Checks for breaking changes and composition errors with all connected federated graphs.');
  command.argument('<name>', 'The name of the subgraph on which the check operation is to be performed.');
  command.option('-n, --namespace [string]', 'The namespace of the subgraph.');
  command.option('--schema <path-to-schema>', 'The path of the new schema file.');
  command.option('--delete', 'Run checks in case the subgraph is deleted.');
  command.option(
    '--skip-traffic-check',
    'This will skip checking for client traffic and any breaking change will fail the run.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the subgraph. The labels are passed in the format <key>=<value> <key>=<value>.' +
      ' This parameter is always ignored if the subgraph already exists.',
    [],
  );

  command.action(async (name, options) => {
    let schemaFile;

    if (!options.schema && !options.delete) {
      program.error("required option '--schema <path-to-schema>' or '--delete' not specified.");
    }

    if (options.schema) {
      schemaFile = resolve(options.schema);
      if (!existsSync(schemaFile)) {
        program.error(
          pc.red(
            pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
          ),
        );
      }
    }

    const { gitInfo, ignoreErrorsDueToGitHubIntegration } = await verifyGitHubIntegration(opts.client);
    let vcsContext: VCSContext | undefined;

    if (config.checkAuthor || config.checkCommitSha || config.checkBranch) {
      vcsContext = new VCSContext({
        author: config.checkAuthor,
        commitSha: config.checkCommitSha,
        branch: config.checkBranch,
      });
    }

    // submit an empty schema in case of a delete check
    const schema = schemaFile ? await readFile(schemaFile) : Buffer.from('');

    const resp = await opts.client.platform.checkSubgraphSchema(
      {
        subgraphName: name,
        namespace: options.namespace,
        schema: new Uint8Array(schema),
        gitInfo,
        delete: options.delete,
        skipTrafficCheck: options.skipTrafficCheck,
        vcsContext,
        labels: options.label.map((label: string) => splitLabel(label)),
      },
      {
        headers: getBaseHeaders(),
      },
    );

    const success = handleCheckResult(resp);

    if (!success && !ignoreErrorsDueToGitHubIntegration) {
      process.exitCode = 1;
      // eslint-disable-next-line no-useless-return
      return;
    }
  });

  return command;
};
