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

export default (opts: BaseCommandOptions) => {
  const command = new Command('check');
  command.description('Checks subgraph schemas for a proposal for breaking changes and composition errors.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '--subgraph <subgraph>',
    'Specify a subgraph to check. Format: <subgraph-name>:<path-to-schema>. Can be specified multiple times.',
    (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    },
    [],
  );
  command.option(
    '--deleted-subgraph <name>',
    'Specify a subgraph to be deleted in the check. Can be specified multiple times.',
    (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    },
    [],
  );
  command.option(
    '--skip-traffic-check',
    'This will skip checking for client traffic and any breaking change will fail the run.',
  );

  command.action(async (options) => {
    if (options.subgraph.length === 0 && options.deletedSubgraph.length === 0) {
      program.error(
        pc.red(
          pc.bold(
            'Please provide at least one subgraph to check using --subgraph or specify a subgraph to delete with --deleted-subgraph.',
          ),
        ),
      );
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

    const checkSubgraphs = [];

    // Process subgraphs to check
    for (const subgraphOption of options.subgraph) {
      const [subgraphName, schemaPath] = subgraphOption.split(':');

      if (!subgraphName || !schemaPath) {
        program.error(
          pc.red(
            pc.bold(`Invalid subgraph format: ${subgraphOption}. Expected format is <subgraph-name>:<path-to-schema>.`),
          ),
        );
      }

      const resolvedSchemaPath = resolve(schemaPath);
      if (!existsSync(resolvedSchemaPath)) {
        program.error(
          pc.red(
            pc.bold(
              `The schema file '${pc.bold(resolvedSchemaPath)}' does not exist. Please check the path and try again.`,
            ),
          ),
        );
      }

      const schemaBuffer = await readFile(resolvedSchemaPath);
      const schema = new TextDecoder().decode(schemaBuffer);
      if (schema.trim().length === 0) {
        program.error(
          pc.red(pc.bold(`The schema file '${pc.bold(resolvedSchemaPath)}' is empty. Please provide a valid schema.`)),
        );
      }
      checkSubgraphs.push({
        name: subgraphName,
        schema,
      });
    }

    // Process subgraphs to delete
    for (const subgraphName of options.deletedSubgraph) {
      checkSubgraphs.push({
        name: subgraphName,
        schema: '',
        delete: true,
      });
    }

    const resp = await opts.client.platform.checkSubgraphSchemas(
      {
        namespace: options.namespace,
        subgraphs: checkSubgraphs,
        gitInfo,
        vcsContext,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    const success = handleCheckResult(resp);

    if (!success && !ignoreErrorsDueToGitHubIntegration) {
      process.exitCode = 1;
    }
  });

  return command;
};
