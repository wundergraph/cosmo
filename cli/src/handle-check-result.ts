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

  const lintIssuesTable = new Table({
    head: [pc.bold(pc.white('LINT_RULE')), pc.bold(pc.white('ERROR_MESSAGE')), pc.bold(pc.white('LINE NUMBER'))],
    colAligns: ['left', 'left', 'center'],
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
      if (
        resp.nonBreakingChanges.length === 0 &&
        resp.breakingChanges.length === 0 &&
        resp.compositionErrors.length === 0 &&
        resp.lintErrors.length === 0 &&
        resp.lintWarnings.length === 0
      ) {
        console.log(`\nDetected no changes.\nDetected no lint issues.\n\n${studioCheckDestination}\n`);

        success = true;

        break;
      }

      console.log(`\nChecking the proposed schema`);

      // No operations usage stats mean the check was not performed against any live traffic
      if (resp.operationUsageStats) {
        if (resp.operationUsageStats.totalOperations === 0) {
          // Composition errors are still considered failures, otherwise we can consider this a success
          // because no operations were affected by the change
          success = resp.compositionErrors.length === 0;
          console.log(`No operations were affected by this schema change.`);
          finalStatement = `This schema change didn't affect any operations from existing client traffic.`;
        } else if (resp.operationUsageStats.totalOperations === resp.operationUsageStats.safeOperations) {
          // This is also a success because changes to these operations were marked as safe
          success = resp.compositionErrors.length === 0;
          console.log(`${resp.operationUsageStats.totalOperations} operations were considered safe due to overrides.`);
          finalStatement = `This schema change affected operations with safe overrides.`;
        } else {
          // Composition and breaking errors are considered failures because operations were affected by the change
          success = resp.breakingChanges.length === 0 && resp.compositionErrors.length === 0;

          console.log(
            logSymbols.warning +
              ` Compared ${pc.bold(resp.breakingChanges.length)} breaking change's impacting ${pc.bold(
                resp.operationUsageStats.totalOperations - resp.operationUsageStats.safeOperations,
              )} operations. ${
                resp.operationUsageStats.safeOperations > 0
                  ? `Also, ${resp.operationUsageStats.safeOperations} operations marked safe due to overrides.`
                  : ''
              } \nFound client activity between ` +
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

      if (resp.lintErrors.length > 0 || resp.lintWarnings.length > 0) {
        success = resp.lintErrors.length === 0;
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
