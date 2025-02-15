import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { VCSContext } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { config, getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { verifyGitHubIntegration } from '../../../github.js';
import { handleCheckResult } from '../../../handle-check-result.js';

// Helper function to read from stdin
async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

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
  command.action(async (name, options) => {
    let schema: Buffer;

    if (!options.schema && !options.delete) {
      program.error("required option '--schema <path-to-schema>' or '--delete' not specified.");
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

    // Handle schema input
    if (options.schema) {
      if (options.schema === '-') {
        // Read from stdin
        schema = await readStdin();
      } else {
        // Read from file
        const schemaFile = resolve(process.cwd(), options.schema);
        if (!existsSync(schemaFile)) {
          program.error(
            pc.red(
              pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
            ),
          );
        }
        schema = await readFile(schemaFile);
      }
    } else {
      // For delete operations
      schema = Buffer.from('');
    }

    const resp = await opts.client.platform.checkSubgraphSchema(
      {
        subgraphName: name,
        namespace: options.namespace,
        schema,
        gitInfo,
        delete: options.delete,
        skipTrafficCheck: options.skipTrafficCheck,
        vcsContext,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    const success = handleCheckResult(resp);

    if (!success && !ignoreErrorsDueToGitHubIntegration) {
      process.exit(1);
    }
  });

  return command;
};
