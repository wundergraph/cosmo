import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PartialMessage } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GitInfo } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import logSymbols from 'log-symbols';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { useGitHub } from '../../../github.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('check');
  command.description('Checks for breaking changes and composition errors with all connected federated graphs.');
  command.argument('<name>', 'The name of the subgraph on which the check operation is to be performed.');
  command.requiredOption('--schema <path-to-schema>', 'The path of the new schema file.');

  command.action(async (name, options) => {
    const schemaFile = resolve(process.cwd(), options.schema);
    if (!existsSync(schemaFile)) {
      console.log(
        pc.red(
          pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
        ),
      );
      return;
    }

    let gitInfo: PartialMessage<GitInfo> | undefined;
    const { isPr, commit: commitSha, repository, accountId } = useGitHub();
    if (isPr && commitSha && repository && accountId) {
      const [ownerSlug, repositorySlug] = repository?.split('/');
      gitInfo = {
        commitSha,
        accountId,
        ownerSlug,
        repositorySlug,
      };
    }

    let ignoreErrors = false;
    if (gitInfo) {
      const integrationCheckResponse = await opts.client.platform.isGitHubAppInstalled(
        {
          gitInfo,
        },
        {
          headers: baseHeaders,
        },
      );
      ignoreErrors = integrationCheckResponse.isInstalled;
      if (ignoreErrors) {
        console.log(
          'GitHub integration detected. The command will succeed and any errors detected will be reflected on commit status instead.',
        );
      }
    }

    const resp = await opts.client.platform.checkSubgraphSchema(
      {
        subgraphName: name,
        schema: await readFile(schemaFile),
        gitInfo,
      },
      {
        headers: baseHeaders,
      },
    );

    const changesTable = new Table({
      head: [pc.bold(pc.white('CHANGE')), pc.bold(pc.white('TYPE')), pc.bold(pc.white('DESCRIPTION'))],
      colWidths: [15, 30, 80],
      wordWrap: true,
    });

    const compositionErrorsTable = new Table({
      head: [pc.bold(pc.white('FEDERATED_GRAPH_NAME')), pc.bold(pc.white('ERROR_MESSAGE'))],
      colWidths: [30, 120],
      wordWrap: true,
    });

    let success = false;
    let finalStatement = '';

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        if (
          resp.nonBreakingChanges.length === 0 &&
          resp.breakingChanges.length === 0 &&
          resp.compositionErrors.length === 0
        ) {
          console.log('\nDetected no changes.\n');

          success = true;

          break;
        }

        console.log(`\nChecking the proposed schema for subgraph ${pc.bold(name)}.`);

        // No operations imply no clients and no subgraphs
        if (resp.operationUsageStats) {
          if (resp.operationUsageStats?.totalOperations === 0) {
            // Composition errors are still considered failures
            success = resp.compositionErrors.length === 0;
            console.log(`No operations were affected by this schema change.`);
            finalStatement = `This schema change didn't affect any operations from existing client traffic.`;
          } else {
            success = resp.breakingChanges.length === 0 && resp.compositionErrors.length === 0;

            console.log(
              logSymbols.warning +
                ` Compared ${pc.bold(resp.breakingChanges.length)} breaking change's impacting ${pc.bold(
                  resp.operationUsageStats.totalOperations,
                )} operations.\nFound client activity between ` +
                pc.underline(new Date(resp.operationUsageStats.firstSeenAt).toLocaleString()) +
                ` and ` +
                pc.underline(new Date(resp.operationUsageStats.lastSeenAt).toLocaleString()),
            );
            finalStatement = `This check has encountered ${pc.bold(
              `${resp.breakingChanges.length}`,
            )} breaking change's that would break operations from existing client traffic.`;
          }
        }

        if (resp.nonBreakingChanges.length > 0 || resp.breakingChanges.length > 0) {
          console.log('\nDetected the following changes:');

          if (resp.breakingChanges.length > 0) {
            for (const breakingChange of resp.breakingChanges) {
              changesTable.push([pc.red('BREAKING'), breakingChange.changeType, breakingChange.message]);
            }
          }

          if (resp.nonBreakingChanges.length > 0) {
            for (const nonBreakingChange of resp.nonBreakingChanges) {
              changesTable.push(['NON-BREAKING', nonBreakingChange.changeType, nonBreakingChange.message]);
            }
          }

          console.log(changesTable.toString());
        }

        if (resp.compositionErrors.length > 0) {
          console.log(pc.red('\nDetected composition errors:'));
          for (const compositionError of resp.compositionErrors) {
            compositionErrorsTable.push([compositionError.federatedGraphName, compositionError.message]);
          }
          console.log(compositionErrorsTable.toString());
        }

        if (success) {
          console.log('\n' + logSymbols.success + pc.green(` Schema check passed. ${finalStatement}`) + '\n');
        } else {
          program.error(
            '\n' +
              logSymbols.error +
              pc.red(
                ` Schema check failed. ${finalStatement}\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving operation check errors.`,
              ) +
              '\n',
          );
        }
        break;
      }
      case EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA: {
        console.log(
          '\nCheck has failed early because the schema could not be built. Please ensure that the schema is valid GraphQL and try again.',
        );
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        program.error(logSymbols.error + pc.red(' Schema check failed.'));
      }
      default: {
        console.log('\nFailed to perform the check operation.');
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        program.error(logSymbols.error + pc.red(' Schema check failed.'));
      }
    }

    if (!success && !ignoreErrors) {
      process.exit(1);
    }
  });

  return command;
};
