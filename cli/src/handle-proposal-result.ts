import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateProposalResponse,
  UpdateProposalResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import { program } from 'commander';
import logSymbols from 'log-symbols';
import pc from 'picocolors';

/**
 * A shared type that represents the relevant response fields from both
 * CreateProposalResponse and UpdateProposalResponse
 */
type ProposalResponse = {
  response?: { code?: EnumStatusCode; details?: string };
  breakingChanges: any[];
  nonBreakingChanges: any[];
  compositionErrors: any[];
  compositionWarnings: any[];
  lintErrors: any[];
  lintWarnings: any[];
  graphPruneErrors: any[];
  graphPruneWarnings: any[];
  checkId?: string;
  checkUrl?: string;
  proposalId?: string;
};

/**
 * Shared handler for proposal command responses (both create and update).
 * Displays schema changes, composition errors, and other issues.
 */
export const handleProposalResult = (
  resp: CreateProposalResponse | UpdateProposalResponse | Error,
  proposalName: string,
  isCreate = false,
): { success: boolean; message?: string } => {
  // Handle network errors or other unexpected issues
  if (resp instanceof Error) {
    return {
      success: false,
      message: pc.red(`Failed to ${isCreate ? 'create' : 'update'} proposal: ${resp.message}`),
    };
  }

  const changesTable = new Table({
    head: [pc.bold(pc.white('CHANGE')), pc.bold(pc.white('TYPE')), pc.bold(pc.white('DESCRIPTION'))],
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
    head: [pc.bold(pc.white('LINT_RULE')), pc.bold(pc.white('ERROR_MESSAGE')), pc.bold(pc.white('LINE NUMBER'))],
    colAligns: ['left', 'left', 'center'],
    wordWrap: true,
  });

  const graphPruningIssuesTable = new Table({
    head: [
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

  if (resp.response?.code !== EnumStatusCode.OK) {
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

    successMessage = isCreate && 'proposalId' in resp ? pc.green(`\nProposal '${proposalName}' was created successfully with ID: ${resp.proposalId}`) : pc.green(`\nProposal '${proposalName}' was updated successfully.`);

    return { success: true, message: successMessage };
  }

  console.log(`\nChecking the proposed schema`);

  // Assume that no operations were affected if there is no operation usage stats
  success =
    resp.breakingChanges.length === 0 &&
    resp.compositionErrors.length === 0 &&
    resp.lintErrors.length === 0 &&
    resp.graphPruneErrors.length === 0;

  if (resp.breakingChanges.length > 0) {
    const warningMessage = [logSymbols.warning, ` Found ${pc.bold(resp.breakingChanges.length)} breaking changes.`];
    console.log(warningMessage.join(''));

    finalStatement = `This check has encountered ${pc.bold(`${resp.breakingChanges.length}`)} breaking changes.`;
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
        error.fieldPath,
        error.message,
        error.issueLocation?.line || '-',
      ]);
    }
    for (const warning of resp.graphPruneWarnings) {
      graphPruningIssuesTable.push([
        `${logSymbols.warning} ${pc.yellow(warning.graphPruningRuleType)}`,
        warning.fieldPath,
        warning.message,
        warning.issueLocation?.line || '-',
      ]);
    }
    console.log(graphPruningIssuesTable.toString());
  }

  if (success) {
    console.log(
      '\n' + logSymbols.success + pc.green(` Schema check passed. ${finalStatement}`) + '\n\n' + studioCheckUrl + '\n',
    );

    successMessage = isCreate && 'proposalId' in resp ? pc.green(`\nProposal '${proposalName}' was created successfully with ID: ${resp.proposalId}`) : pc.green(`\nProposal '${proposalName}' was updated successfully.`);

    return { success: true, message: successMessage };
  } else {
    console.error(
      '\n' +
        logSymbols.error +
        pc.red(
          ` Schema check failed. ${finalStatement}\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving schema check errors.\n${studioCheckUrl}\n`,
        ) +
        '\n',
    );

    return { success: false };
  }
};
