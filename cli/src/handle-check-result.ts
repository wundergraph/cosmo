import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CheckSubgraphSchemaResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import { program } from 'commander';
import logSymbols from 'log-symbols';
import pc from 'picocolors';
import { config } from './core/config.js';

export const handleCheckResult = (resp: CheckSubgraphSchemaResponse) => {
  const changesTable = new Table({
    head: [pc.bold(pc.white('CHANGE')), pc.bold(pc.white('TYPE')), pc.bold(pc.white('DESCRIPTION'))],
    wordWrap: true,
  });

  const compositionErrorsTable = new Table({
    head: [pc.bold(pc.white('GRAPH_NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('ERROR_MESSAGE'))],
    colWidths: [30, 30, 120],
    wordWrap: true,
  });

  const compositionWarningsTable = new Table({
    head: [pc.bold(pc.white('GRAPH_NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('WARNING_MESSAGE'))],
    colWidths: [30, 30, 120],
    wordWrap: true,
  });

  const lintIssuesTable = new Table({
    head: [pc.bold(pc.white('LINT_RULE')), pc.bold(pc.white('ERROR_MESSAGE')), pc.bold(pc.white('LINE NUMBER'))],
    colAligns: ['left', 'left', 'center'],
    wordWrap: true,
  });

  const graphPruningIssuesTable = new Table({
    head: [
      pc.bold(pc.white('RULE')),
      pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
      pc.bold(pc.white('FIELD_PATH')),
      pc.bold(pc.white('MESSAGE')),
      pc.bold(pc.white('LINE NUMBER')),
    ],
    colAligns: ['left', 'left', 'left', 'left', 'center'],
    wordWrap: true,
  });

  let success = false;
  let finalStatement = '';

  let studioCheckDestination = '';
  if (resp.checkId && resp.checkedFederatedGraphs.length > 0) {
    studioCheckDestination = `${pc.bold('Open in studio')}: ${config.webURL}/${
      resp.checkedFederatedGraphs[0].organizationSlug
    }/${resp.checkedFederatedGraphs[0].namespace}/graph/${resp.checkedFederatedGraphs[0].name}/checks/${resp.checkId}`;
  }

  switch (resp.response?.code) {
    case EnumStatusCode.OK: {
      if (resp.proposalMatchMessage) {
        console.log(pc.yellow(`Warning: Proposal match failed`));
        console.log(pc.yellow(resp.proposalMatchMessage));
      }

      if (
        resp.nonBreakingChanges.length === 0 &&
        resp.breakingChanges.length === 0 &&
        resp.compositionErrors.length === 0 &&
        resp.lintErrors.length === 0 &&
        resp.lintWarnings.length === 0 &&
        resp.graphPruneErrors.length === 0 &&
        resp.graphPruneWarnings.length === 0
      ) {
        console.log(
          `\nDetected no changes.\nDetected no lint issues.\nDetected no graph pruning issues.\n\n${studioCheckDestination}\n`,
        );

        success = true;

        break;
      }

      console.log(`\nChecking the proposed schema`);

      // No operations usage stats mean the check was not performed against any live traffic
      if (resp.operationUsageStats) {
        if (resp.operationUsageStats.totalOperations === 0 && !resp.clientTrafficCheckSkipped) {
          // Composition errors are still considered failures, otherwise we can consider this a success
          // because no operations were affected by the change
          success =
            resp.compositionErrors.length === 0 && resp.lintErrors.length === 0 && resp.graphPruneErrors.length === 0;
          console.log(`No operations were affected by this schema change.`);
          finalStatement = `This schema change didn't affect any operations from existing client traffic.`;
        } else if (
          resp.operationUsageStats.totalOperations === resp.operationUsageStats.safeOperations &&
          !resp.clientTrafficCheckSkipped
        ) {
          // This is also a success because changes to these operations were marked as safe
          success =
            resp.compositionErrors.length === 0 && resp.lintErrors.length === 0 && resp.graphPruneErrors.length === 0;
          console.log(`${resp.operationUsageStats.totalOperations} operations were considered safe due to overrides.`);
          finalStatement = `This schema change affected operations with safe overrides.`;
        } else {
          // Composition and breaking errors are considered failures because operations were affected by the change
          success =
            resp.breakingChanges.length === 0 &&
            resp.compositionErrors.length === 0 &&
            resp.lintErrors.length === 0 &&
            resp.graphPruneErrors.length === 0;

          const { breakingChanges, operationUsageStats, clientTrafficCheckSkipped } = resp;
          const { totalOperations, safeOperations, firstSeenAt, lastSeenAt } = operationUsageStats;

          if (breakingChanges.length > 0) {
            const warningMessage = [logSymbols.warning, ` Found ${pc.bold(breakingChanges.length)} breaking changes.`];

            if (totalOperations > 0) {
              warningMessage.push(`${pc.bold(totalOperations - safeOperations)} operations impacted.`);
            }

            if (safeOperations > 0) {
              warningMessage.push(`In addition, ${safeOperations} operations marked safe due to overrides.`);
            }

            if (!clientTrafficCheckSkipped) {
              warningMessage.push(
                `\nFound client activity between ${pc.underline(
                  new Date(firstSeenAt).toLocaleString(),
                )} and ${pc.underline(new Date(lastSeenAt).toLocaleString())}.`,
              );
            }

            console.log(warningMessage.join(''));

            finalStatement = `This check has encountered ${pc.bold(`${breakingChanges.length}`)} breaking changes${
              clientTrafficCheckSkipped ? `.` : ` that would break operations from existing client traffic.`
            }`;
          }
        }
      }

      if (resp.nonBreakingChanges.length > 0 || resp.breakingChanges.length > 0) {
        console.log('\nDetected the following changes:');

        if (resp.breakingChanges.length > 0) {
          for (const breakingChange of resp.breakingChanges) {
            changesTable.push([
              `${logSymbols.error} ${pc.red('BREAKING')}`,
              breakingChange.changeType,
              breakingChange.message,
            ]);
          }
        }

        if (resp.nonBreakingChanges.length > 0) {
          for (const nonBreakingChange of resp.nonBreakingChanges) {
            changesTable.push([
              `${logSymbols.success} NON-BREAKING`,
              nonBreakingChange.changeType,
              nonBreakingChange.message,
            ]);
          }
        }

        console.log(changesTable.toString());
      }

      if (resp.compositionErrors.length > 0) {
        console.log(pc.red('\nDetected composition errors:'));
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.message,
          ]);
        }
        console.log(compositionErrorsTable.toString());
      }

      if (resp.compositionWarnings.length > 0) {
        console.log(pc.yellow(`\nDetected composition warnings:`));
        for (const compositionWarning of resp.compositionWarnings) {
          compositionWarningsTable.push([
            compositionWarning.federatedGraphName,
            compositionWarning.namespace,
            compositionWarning.message,
          ]);
        }
        console.log(compositionWarningsTable.toString());
      }

      if (resp.lintErrors.length > 0 || resp.lintWarnings.length > 0) {
        console.log('\nDetected lint issues:');
        for (const error of resp.lintErrors) {
          lintIssuesTable.push([
            `${logSymbols.error} ${pc.red(error.lintRuleType)}`,
            error.message,
            error.issueLocation?.line,
          ]);
        }
        for (const warning of resp.lintWarnings) {
          lintIssuesTable.push([
            `${logSymbols.warning} ${pc.yellow(warning.lintRuleType)}`,
            warning.message,
            warning.issueLocation?.line,
          ]);
        }
        console.log(lintIssuesTable.toString());
      }

      if (resp.graphPruneErrors.length > 0 || resp.graphPruneWarnings.length > 0) {
        console.log('\nDetected graph pruning issues:');
        for (const error of resp.graphPruneErrors) {
          graphPruningIssuesTable.push([
            `${logSymbols.error} ${pc.red(error.graphPruningRuleType)}`,
            error.federatedGraphName,
            error.fieldPath,
            error.message,
            error.issueLocation?.line || '-',
          ]);
        }
        for (const warning of resp.graphPruneWarnings) {
          graphPruningIssuesTable.push([
            `${logSymbols.warning} ${pc.yellow(warning.graphPruningRuleType)}`,
            warning.federatedGraphName,
            warning.fieldPath,
            warning.message,
            warning.issueLocation?.line || '-',
          ]);
        }
        console.log(graphPruningIssuesTable.toString());
      }

      if (resp.isLinkedTrafficCheckFailed || resp.isLinkedPruningCheckFailed) {
        finalStatement += success
          ? `\n\n But this schema change has been linked to a target subgraph and the target subgraph check has failed.`
          : `\n\n This schema change has been linked to a target subgraph and the target subgraph check has failed.`;

        if (resp.isLinkedTrafficCheckFailed) {
          finalStatement += `\n\n The target subgraph check has failed because of client traffic issues.`;
        }

        if (resp.isLinkedPruningCheckFailed) {
          finalStatement += `\n\n The target subgraph check has failed because of graph pruning issues.`;
        }
        success = false;
      }

      if (success) {
        console.log(
          '\n' +
            logSymbols.success +
            pc.green(` Schema check passed. ${finalStatement}`) +
            '\n\n' +
            studioCheckDestination +
            '\n',
        );
      } else {
        program.error(
          '\n' +
            logSymbols.error +
            pc.red(
              ` Schema check failed. ${finalStatement}\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving operation check errors.\n${studioCheckDestination}\n`,
            ) +
            '\n',
        );
      }
      break;
    }
    case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
      console.log(pc.red(`Error: Proposal match failed`));
      console.log(pc.red(resp.proposalMatchMessage));
      console.log(
        logSymbols.error +
          pc.red(
            `Schema check failed.\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving operation check errors.\n${studioCheckDestination}\n`,
          ),
      );
      success = false;
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
      break;
    }
    default: {
      console.log('\nFailed to perform the check operation.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      program.error(logSymbols.error + pc.red(' Schema check failed.'));
    }
  }

  return success;
};
