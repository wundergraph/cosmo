import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PartialMessage } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GitInfo } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import { Command } from 'commander';
import logSymbols from 'log-symbols';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { baseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { useGitHub } from '../../../github.js';

export default (opts: BaseCommandOptions) => {
  const schemaCheck = new Command('check');
  schemaCheck.description('Checks for breaking changes and composition errors with all connected federated graphs.');
  schemaCheck.argument('<name>', 'The name of the subgraph on which the check operation is to be performed.');
  schemaCheck.requiredOption('--schema <path-to-schema>', 'The path of the new schema file.');

  schemaCheck.action(async (name, options) => {
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
      const [repositorySlug, ownerSlug] = repository?.split('/');
      gitInfo = {
        commitSha,
        accountId,
        ownerSlug,
        repositorySlug,
      };
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

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        if (
          resp.nonBreakingChanges.length === 0 &&
          resp.breakingChanges.length === 0 &&
          resp.compositionErrors.length === 0
        ) {
          console.log('\nDetected no changes.');

          success = true;

          break;
        }

        success = resp.breakingChanges.length === 0 && resp.compositionErrors.length === 0;

        if (resp.nonBreakingChanges.length > 0 || resp.breakingChanges.length > 0) {
          console.log('\nDetected the following changes.');

          if (resp.breakingChanges.length > 0) {
            for (const breakingChange of resp.breakingChanges) {
              changesTable.push([
                pc.red('BREAKING'),
                pc.red(breakingChange.changeType),
                pc.red(breakingChange.message),
              ]);
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
          console.log(pc.red('\nDetected composition errors.'));
          for (const compositionError of resp.compositionErrors) {
            compositionErrorsTable.push([compositionError.federatedGraphName, compositionError.message]);
          }
          console.log(compositionErrorsTable.toString());
        }

        if (success) {
          console.log('\n' + logSymbols.success + pc.green(' Schema check passed.'));
        } else {
          console.log('\n' + logSymbols.error + pc.red(' Schema check failed.'));
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
        console.log(logSymbols.error + pc.red(' Schema check failed.'));
        break;
      }
      default: {
        console.log('\nFailed to perform the check operation.');
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        console.log(logSymbols.error + pc.red(' Schema check failed.'));
      }
    }

    if (!success) {
      process.exit(1);
    }
  });

  return schemaCheck;
};
