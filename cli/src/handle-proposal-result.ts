import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateProposalResponse,
  UpdateProposalResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import logSymbols from 'log-symbols';
import pc from 'picocolors';

/**
 * Shared handler for proposal command responses (both create and update).
 * Displays schema changes, composition errors, and other issues.
 */
export const handleProposalResult = (
  resp: CreateProposalResponse | UpdateProposalResponse,
  proposalName: string,
  isCreate = false,
): { success: boolean; message?: string } => {
  const changesTable = new Table({
    head: [
      pc.bold(pc.white('SUBGRAPH_NAME')),
      pc.bold(pc.white('CHANGE')),
      pc.bold(pc.white('TYPE')),
      pc.bold(pc.white('DESCRIPTION')),
    ],
    wordWrap: true,
  });

  const compositionErrorsTable = new Table({
    head: [pc.bold(pc.white('ERROR_MESSAGE'))],
    colWidths: [120],
    wordWrap: true,
  });

  const compositionWarningsTable = new Table({
    head: [pc.bold(pc.white('WARNING_MESSAGE'))],
    colWidths: [120],
    wordWrap: true,
  });

  const lintIssuesTable = new Table({
    head: [
      pc.bold(pc.white('SUBGRAPH_NAME')),
      pc.bold(pc.white('LINT_RULE')),
      pc.bold(pc.white('ERROR_MESSAGE')),
      pc.bold(pc.white('LINE NUMBER')),
    ],
    colAligns: ['left', 'left', 'center'],
    wordWrap: true,
  });

  const graphPruningIssuesTable = new Table({
    head: [
      pc.bold(pc.white('SUBGRAPH_NAME')),
      pc.bold(pc.white('RULE')),
      pc.bold(pc.white('FIELD_PATH')),
      pc.bold(pc.white('MESSAGE')),
      pc.bold(pc.white('LINE NUMBER')),
    ],
    colAligns: ['left', 'left', 'left', 'center'],
    wordWrap: true,
  });

  let success = false;
  let finalStatement = '';
  let successMessage = '';

  let studioCheckUrl = '';
  if (resp.checkUrl) {
    studioCheckUrl = `${pc.bold('Open in studio')}: ${resp.checkUrl}`;
  }

  if (resp.response?.code === EnumStatusCode.OK) {
    successMessage = isCreate
      ? pc.green(`Proposal '${proposalName}' was created successfully.`)
      : pc.green(`Proposal '${proposalName}' was updated successfully.`);
  } else {
    return {
      success: false,
      message: resp.response?.details
        ? pc.red(pc.bold(resp.response.details))
        : pc.red(`Failed to ${isCreate ? 'create' : 'update'} proposal.`),
    };
  }

  // Handle successful response
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
      `\nDetected no changes.\nDetected no lint issues.\nDetected no graph pruning issues.\n\n${studioCheckUrl}\n`,
    );

    success = true;

    return { success: true, message: successMessage };
  }

  console.log(`\nChecking the proposed schema`);

  // No operations usage stats mean the check was not performed against any live traffic
  if (resp.operationUsageStats) {
    if (resp.operationUsageStats.totalOperations === 0) {
      // Composition errors are still considered failures, otherwise we can consider this a success
      // because no operations were affected by the change
      success =
        resp.compositionErrors.length === 0 && resp.lintErrors.length === 0 && resp.graphPruneErrors.length === 0;
      console.log(`No operations were affected by this schema change.`);
      finalStatement = `This schema change didn't affect any operations from existing client traffic.`;
    } else if (resp.operationUsageStats.totalOperations === resp.operationUsageStats.safeOperations) {
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

      const { breakingChanges, operationUsageStats } = resp;
      const { totalOperations, safeOperations, firstSeenAt, lastSeenAt } = operationUsageStats;

      if (breakingChanges.length > 0) {
        const warningMessage = [logSymbols.warning, ` Found ${pc.bold(breakingChanges.length)} breaking changes.`];

        if (totalOperations > 0) {
          warningMessage.push(`${pc.bold(totalOperations - safeOperations)} operations impacted.`);
        }

        if (safeOperations > 0) {
          warningMessage.push(`In addition, ${safeOperations} operations marked safe due to overrides.`);
        }

        console.log(warningMessage.join(''));

        finalStatement = `This check has encountered ${pc.bold(`${breakingChanges.length}`)} breaking changes that would break operations from existing client traffic.`;
      }
    }
  }

  if (resp.nonBreakingChanges.length > 0 || resp.breakingChanges.length > 0) {
    console.log('\nDetected the following changes:');

    if (resp.breakingChanges.length > 0) {
      for (const breakingChange of resp.breakingChanges) {
        changesTable.push([
          breakingChange.subgraphName || '-',
          `${logSymbols.error} ${pc.red('BREAKING')}`,
          breakingChange.changeType,
          breakingChange.message,
        ]);
      }
    }

    if (resp.nonBreakingChanges.length > 0) {
      for (const nonBreakingChange of resp.nonBreakingChanges) {
        changesTable.push([
          nonBreakingChange.subgraphName || '-',
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
      compositionErrorsTable.push([compositionError.message]);
    }
    console.log(compositionErrorsTable.toString());
  }

  if (resp.compositionWarnings.length > 0) {
    console.log(pc.yellow(`\nDetected composition warnings:`));
    for (const compositionWarning of resp.compositionWarnings) {
      compositionWarningsTable.push([compositionWarning.message]);
    }
    console.log(compositionWarningsTable.toString());
  }

  if (resp.lintErrors.length > 0 || resp.lintWarnings.length > 0) {
    console.log('\nDetected lint issues:');
    for (const error of resp.lintErrors) {
      lintIssuesTable.push([
        error.subgraphName || '-',
        `${logSymbols.error} ${pc.red(error.lintRuleType)}`,
        error.message,
        error.issueLocation?.line,
      ]);
    }
    for (const warning of resp.lintWarnings) {
      lintIssuesTable.push([
        warning.subgraphName || '-',
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
        error.subgraphName || '-',
        `${logSymbols.error} ${pc.red(error.graphPruningRuleType)}`,
        error.fieldPath,
        error.message,
        error.issueLocation?.line || '-',
      ]);
    }
    for (const warning of resp.graphPruneWarnings) {
      graphPruningIssuesTable.push([
        warning.subgraphName || '-',
        `${logSymbols.warning} ${pc.yellow(warning.graphPruningRuleType)}`,
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
        pc.green(` Schema check with the proposed schemas passed. ${finalStatement}`) +
        '\n\n' +
        studioCheckUrl +
        '\n',
    );

    return { success: true, message: successMessage };
  } else {
    console.error(
      '\n' +
        logSymbols.error +
        pc.red(
          ` Schema check with the proposed schemas failed. ${finalStatement}\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving schema check errors.\n${studioCheckUrl}\n`,
        ),
    );

    return { success: true, message: successMessage };
  }
};
