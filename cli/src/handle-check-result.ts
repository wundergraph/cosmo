import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  CheckSubgraphSchemaResponse,
  CheckOperationUsageStats,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import { program } from 'commander';
import logSymbols from 'log-symbols';
import pc from 'picocolors';
import { config } from './core/config.js';
import { JsonCheckSchemaOutputBuilder } from './json-check-schema-output-builder.js';

// operationUsageStats is required — caller must guard with `if (response.operationUsageStats)` before calling
const handleTrafficCheck = (
  response: CheckSubgraphSchemaResponse,
  operationUsageStats: CheckOperationUsageStats,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): { success: boolean; finalStatement: string } => {
  const {
    clientTrafficCheckSkipped,
    compositionErrors,
    lintErrors,
    graphPruneErrors,
    breakingChanges,
    composedSchemaBreakingChanges,
  } = response;
  const { totalOperations, safeOperations, firstSeenAt, lastSeenAt } = operationUsageStats;

  if (totalOperations === 0 && !clientTrafficCheckSkipped) {
    // Composition errors are still considered failures, otherwise we can consider this a success
    // because no operations were affected by the change
    const success = compositionErrors.length === 0 && lintErrors.length === 0 && graphPruneErrors.length === 0;
    const message = 'No operations were affected by this schema change.';
    jsonBuilder.setTraffic(message);
    if (!shouldOutputJson) {
      console.log(message);
    }
    return { success, finalStatement: `This schema change didn't affect any operations from existing client traffic.` };
  }

  if (totalOperations === safeOperations && !clientTrafficCheckSkipped) {
    // This is also a success because changes to these operations were marked as safe
    const success = compositionErrors.length === 0 && lintErrors.length === 0 && graphPruneErrors.length === 0;
    const message = `${totalOperations} operations were considered safe due to overrides.`;
    jsonBuilder.setTraffic(message);
    if (!shouldOutputJson) {
      console.log(message);
    }
    return { success, finalStatement: `This schema change affected operations with safe overrides.` };
  }

  // Composition and breaking errors are considered failures because operations were affected
  const success =
    breakingChanges.length === 0 &&
    composedSchemaBreakingChanges.length === 0 &&
    compositionErrors.length === 0 &&
    lintErrors.length === 0 &&
    graphPruneErrors.length === 0;
  let finalStatement = '';

  const totalBreakingChanges = breakingChanges.length + composedSchemaBreakingChanges.length;

  if (breakingChanges.length > 0 || composedSchemaBreakingChanges.length > 0) {
    jsonBuilder.addBreakingChanges(breakingChanges);

    const warningMessage = [logSymbols.warning, ` Found ${pc.bold(totalBreakingChanges)} breaking changes.`];
    const jsonMessage = [`Found ${totalBreakingChanges} breaking changes.`];
    if (totalOperations > 0) {
      warningMessage.push(`${pc.bold(totalOperations - safeOperations)} operations impacted.`);
      jsonMessage.push(`${totalOperations - safeOperations} operations impacted.`);
    }
    if (safeOperations > 0) {
      warningMessage.push(`In addition, ${safeOperations} operations marked safe due to overrides.`);
      jsonMessage.push(`In addition, ${safeOperations} operations marked safe due to overrides.`);
    }
    if (!clientTrafficCheckSkipped) {
      warningMessage.push(
        `\nFound client activity between ${pc.underline(new Date(firstSeenAt).toLocaleString())} and ${pc.underline(new Date(lastSeenAt).toLocaleString())}.`,
      );
      jsonMessage.push(
        `Found client activity between ${new Date(firstSeenAt).toLocaleString()} and ${new Date(lastSeenAt).toLocaleString()}.`,
      );
      jsonBuilder.setTraffic(jsonMessage.join(' '));
      jsonBuilder.setOperationUsageStats(operationUsageStats);
    }
    if (!shouldOutputJson) {
      console.log(warningMessage.join(''));
    }

    finalStatement = `This check has encountered ${pc.bold(`${totalBreakingChanges}`)} breaking changes${
      clientTrafficCheckSkipped ? `.` : ` that would break operations from existing client traffic.`
    }`;
  }

  return { success, finalStatement };
};

const handleSchemaChanges = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): void => {
  if (response.breakingChanges.length > 0) {
    jsonBuilder.addBreakingChanges(response.breakingChanges);
  }
  if (response.nonBreakingChanges.length > 0) {
    jsonBuilder.addNonBreakingChanges(response.nonBreakingChanges);
  }

  if (shouldOutputJson) {
    return;
  }

  console.log('\nDetected the following subgraph schema changes:');
  const changesTable = new Table({
    head: [pc.bold(pc.white('CHANGE')), pc.bold(pc.white('TYPE')), pc.bold(pc.white('DESCRIPTION'))],
    wordWrap: true,
  });
  for (const change of response.breakingChanges) {
    changesTable.push([`${logSymbols.error} ${pc.red('BREAKING')}`, change.changeType, change.message]);
  }
  for (const change of response.nonBreakingChanges) {
    changesTable.push([`${logSymbols.success} NON-BREAKING`, change.changeType, change.message]);
  }
  console.log(changesTable.toString());
};

const handleComposedSchemaBreakingChanges = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): void => {
  jsonBuilder.addComposedSchemaBreakingChanges(response.composedSchemaBreakingChanges);

  if (shouldOutputJson) {
    return;
  }

  const composedSchemaChangesTable = new Table({
    head: [
      pc.bold(pc.white('CHANGE')),
      pc.bold(pc.white('TYPE')),
      pc.bold(pc.white('FEDERATED_GRAPH')),
      pc.bold(pc.white('DESCRIPTION')),
    ],
    wordWrap: true,
  });

  for (const change of response.composedSchemaBreakingChanges) {
    composedSchemaChangesTable.push([
      `${logSymbols.error} ${pc.red('BREAKING')}`,
      change.changeType,
      change.federatedGraphName,
      change.message,
    ]);
  }

  console.log(pc.red('\nDetected the following federated graph schema breaking changes:'));
  console.log(
    pc.dim(
      'These breaking changes were detected in the composed federated graph schema after composition. They are not reported above because they only become visible when all subgraphs are composed together (e.g., field type or nullability conflicts between subgraphs).',
    ),
  );
  console.log(composedSchemaChangesTable.toString());
};

const handleCompositionErrors = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): void => {
  jsonBuilder.addCompositionErrors(response.compositionErrors);

  if (!shouldOutputJson) {
    const compositionErrorsTable = new Table({
      head: [pc.bold(pc.white('GRAPH_NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('ERROR_MESSAGE'))],
      colWidths: [30, 30, 120],
      wordWrap: true,
    });
    for (const error of response.compositionErrors) {
      compositionErrorsTable.push([error.federatedGraphName, error.namespace, error.message]);
    }
    console.log(pc.red('\nDetected composition errors:'));
    console.log(compositionErrorsTable.toString());
  }
};

const handleCompositionWarnings = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): void => {
  jsonBuilder.addCompositionWarnings(response.compositionWarnings);

  if (!shouldOutputJson) {
    const compositionWarningsTable = new Table({
      head: [pc.bold(pc.white('GRAPH_NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('WARNING_MESSAGE'))],
      colWidths: [30, 30, 120],
      wordWrap: true,
    });
    for (const warning of response.compositionWarnings) {
      compositionWarningsTable.push([warning.federatedGraphName, warning.namespace, warning.message]);
    }
    console.log(pc.yellow(`\nDetected composition warnings:`));
    console.log(compositionWarningsTable.toString());
  }
};

const handleLintIssues = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): void => {
  jsonBuilder.addLintErrors(response.lintErrors);
  jsonBuilder.addLintWarnings(response.lintWarnings);

  if (!shouldOutputJson) {
    const lintIssuesTable = new Table({
      head: [pc.bold(pc.white('LINT_RULE')), pc.bold(pc.white('ERROR_MESSAGE')), pc.bold(pc.white('LINE NUMBER'))],
      colAligns: ['left', 'left', 'center'],
      wordWrap: true,
    });
    for (const error of response.lintErrors) {
      lintIssuesTable.push([
        `${logSymbols.error} ${pc.red(error.lintRuleType)}`,
        error.message,
        error.issueLocation?.line,
      ]);
    }
    for (const warning of response.lintWarnings) {
      lintIssuesTable.push([
        `${logSymbols.warning} ${pc.yellow(warning.lintRuleType)}`,
        warning.message,
        warning.issueLocation?.line,
      ]);
    }
    console.log('\nDetected lint issues:');
    console.log(lintIssuesTable.toString());
  }
};

const handleGraphPruneIssues = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  shouldOutputJson: boolean,
): void => {
  jsonBuilder.addGraphPruneErrors(response.graphPruneErrors);
  jsonBuilder.addGraphPruneWarnings(response.graphPruneWarnings);

  if (!shouldOutputJson) {
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
    for (const error of response.graphPruneErrors) {
      graphPruningIssuesTable.push([
        `${logSymbols.error} ${pc.red(error.graphPruningRuleType)}`,
        error.federatedGraphName,
        error.fieldPath,
        error.message,
        error.issueLocation?.line || '-',
      ]);
    }
    for (const warning of response.graphPruneWarnings) {
      graphPruningIssuesTable.push([
        `${logSymbols.warning} ${pc.yellow(warning.graphPruningRuleType)}`,
        warning.federatedGraphName,
        warning.fieldPath,
        warning.message,
        warning.issueLocation?.line || '-',
      ]);
    }
    console.log('\nDetected graph pruning issues:');
    console.log(graphPruningIssuesTable.toString());
  }
};

// currentSuccess determines which sentence variant to use in the returned statement
const handleLinkedCheckFailures = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonCheckSchemaOutputBuilder,
  currentSuccess: boolean,
): string => {
  let additionalStatement = currentSuccess
    ? `\n\n But this schema change has been linked to a target subgraph and the target subgraph check has failed.`
    : `\n\n This schema change has been linked to a target subgraph and the target subgraph check has failed.`;

  if (response.isLinkedTrafficCheckFailed) {
    const message = 'The target subgraph check has failed because of client traffic issues.';
    additionalStatement += `\n\n ${message}`;
    jsonBuilder.markTrafficLinkedFailed(message);
  }

  if (response.isLinkedPruningCheckFailed) {
    jsonBuilder.markGraphPruneLinkedFailed();
    additionalStatement += `\n\n The target subgraph check has failed because of graph pruning issues.`;
  }

  return additionalStatement;
};

const handleOkResult = ({
  response,
  jsonBuilder,
  rowLimit,
  shouldOutputJson,
  studioCheckDestination,
}: {
  response: CheckSubgraphSchemaResponse;
  jsonBuilder: JsonCheckSchemaOutputBuilder;
  rowLimit: number;
  shouldOutputJson?: boolean;
  studioCheckDestination: string;
}): { success: boolean } => {
  let success = false;
  let finalStatement = '';

  // Proposal match warning — always build json, conditionally print
  if (response.proposalMatchMessage) {
    jsonBuilder.setProposals(response.proposalMatchMessage);
    if (!shouldOutputJson) {
      console.log(pc.yellow(`Warning: Proposal match failed`));
      console.log(pc.yellow(response.proposalMatchMessage));
    }
  }

  // Early exit: nothing to report
  const hasNoIssues =
    response.nonBreakingChanges.length === 0 &&
    response.breakingChanges.length === 0 &&
    response.composedSchemaBreakingChanges.length === 0 &&
    response.compositionErrors.length === 0 &&
    response.lintErrors.length === 0 &&
    response.lintWarnings.length === 0 &&
    response.graphPruneErrors.length === 0 &&
    response.graphPruneWarnings.length === 0 &&
    (response.isCheckExtensionSkipped ?? true);

  if (hasNoIssues) {
    jsonBuilder.initProposals('Detected no changes. Detected no lint issues. Detected no graph pruning issues.');
    jsonBuilder.setStatus(true);
    if (!shouldOutputJson) {
      console.log(
        `\nDetected no changes.\nDetected no lint issues.\nDetected no graph pruning issues.\n\n${studioCheckDestination}\n`,
      );
    }
    return { success: true };
  }

  if (!shouldOutputJson) {
    console.log(`\nChecking the proposed schema`);
  }

  // No operations usage stats mean the check was not performed against any live traffic
  if (response.operationUsageStats) {
    ({ success, finalStatement } = handleTrafficCheck(
      response,
      response.operationUsageStats,
      jsonBuilder,
      shouldOutputJson ?? false,
    ));
  }

  // Schema changes — build json always, build + print table only for text output
  if (response.nonBreakingChanges.length > 0 || response.breakingChanges.length > 0) {
    handleSchemaChanges(response, jsonBuilder, shouldOutputJson ?? false);
  }

  // Composed federated graph schema breaking changes
  if (response.composedSchemaBreakingChanges.length > 0) {
    handleComposedSchemaBreakingChanges(response, jsonBuilder, shouldOutputJson ?? false);
  }

  // Composition errors
  if (response.compositionErrors.length > 0) {
    handleCompositionErrors(response, jsonBuilder, shouldOutputJson ?? false);
  }

  // Composition warnings
  if (response.compositionWarnings.length > 0) {
    handleCompositionWarnings(response, jsonBuilder, shouldOutputJson ?? false);
  }

  // Lint issues
  if (response.lintErrors.length > 0 || response.lintWarnings.length > 0) {
    handleLintIssues(response, jsonBuilder, shouldOutputJson ?? false);
  }

  // Graph pruning issues
  if (response.graphPruneErrors.length > 0 || response.graphPruneWarnings.length > 0) {
    handleGraphPruneIssues(response, jsonBuilder, shouldOutputJson ?? false);
  }

  // Linked subgraph check failures
  if (response.isLinkedTrafficCheckFailed || response.isLinkedPruningCheckFailed) {
    finalStatement += handleLinkedCheckFailures(response, jsonBuilder, success);
    success = false;
  }

  // Extension error
  if (response.checkExtensionErrorMessage) {
    const message = `Subgraph extension check failed with message: ${response.checkExtensionErrorMessage}`;
    jsonBuilder.setExtensionError(message);
    success = false;
    finalStatement += `\n${logSymbols.error} ${message}`;
  }

  // Row limit exceeded message
  let moreEntriesAvailableMessage = '';
  if (response.counts) {
    const hasExceeded =
      response.counts.lintWarnings + response.counts.lintErrors > rowLimit ||
      response.counts.breakingChanges + response.counts.nonBreakingChanges > rowLimit ||
      response.counts.graphPruneErrors + response.counts.graphPruneWarnings > rowLimit ||
      response.counts.compositionErrors > rowLimit ||
      response.counts.compositionWarnings > rowLimit ||
      response.counts.composedSchemaBreakingChanges > rowLimit;

    jsonBuilder.setExceededRowLimit(hasExceeded);

    if (hasExceeded) {
      if (studioCheckDestination !== '') {
        moreEntriesAvailableMessage += `\n\n`;
      }
      moreEntriesAvailableMessage += pc.red(
        `Some results were truncated due to exceeding the limit of ${rowLimit} rows.`,
      );
      if (studioCheckDestination !== '') {
        moreEntriesAvailableMessage += ` They can be viewed in the studio dashboard.`;
      }
    }
  }

  // Finalise json state, then print text output if not in JSON mode
  jsonBuilder.setStatus(success).setMessage(finalStatement);

  if (!shouldOutputJson) {
    if (success) {
      console.log(
        '\n' +
          logSymbols.success +
          pc.green(` Schema check passed. ${finalStatement}`) +
          '\n\n' +
          studioCheckDestination +
          moreEntriesAvailableMessage +
          '\n',
      );
    } else {
      program.error(
        '\n' +
          logSymbols.error +
          pc.red(
            ` Schema check failed. ${finalStatement}\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving operation check errors.\n${studioCheckDestination}${moreEntriesAvailableMessage}\n`,
          ) +
          '\n',
      );
    }
  }

  return { success };
};

export const handleCheckResult = async ({
  response,
  rowLimit,
  shouldOutputJson,
  outFile,
}: {
  response: CheckSubgraphSchemaResponse;
  rowLimit: number;
  shouldOutputJson?: boolean;
  outFile?: string;
}): Promise<boolean> => {
  const jsonBuilder = new JsonCheckSchemaOutputBuilder(EnumStatusCode.ERR, rowLimit, outFile);

  let studioCheckDestination = '';
  if (response.checkId && response.checkedFederatedGraphs.length > 0) {
    const url = `${config.webURL}/${
      response.checkedFederatedGraphs[0].organizationSlug
    }/${response.checkedFederatedGraphs[0].namespace}/graph/${response.checkedFederatedGraphs[0].name}/checks/${response.checkId}`;
    jsonBuilder.setUrl(url);
    studioCheckDestination = `${pc.bold('Open in studio')}: ${url}`;
  }

  switch (response.response?.code) {
    case EnumStatusCode.OK: {
      const { success } = handleOkResult({ response, jsonBuilder, rowLimit, shouldOutputJson, studioCheckDestination });
      if (shouldOutputJson) {
        await jsonBuilder.write();
      }
      return success;
    }
    case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
      const message = 'Error: Proposal match failed';
      if (shouldOutputJson) {
        await jsonBuilder
          .setCode(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL)
          .setDetails(response.proposalMatchMessage)
          .setMessage(message)
          .setStatus(false)
          .write();
      } else {
        console.log(pc.red(message));
        console.log(pc.red(response.proposalMatchMessage));
        console.log(
          logSymbols.error +
            pc.red(
              `Schema check failed.\nSee https://cosmo-docs.wundergraph.com/studio/schema-checks for more information on resolving operation check errors.\n${studioCheckDestination}\n`,
            ),
        );
      }
      return false;
    }
    case EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA: {
      const message =
        'Check has failed early because the schema could not be built. Please ensure that the schema is valid GraphQL and try again.';
      if (shouldOutputJson) {
        await jsonBuilder
          .setCode(EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA)
          .setDetails(response.response?.details)
          .setMessage(message)
          .setStatus(false)
          .write();
        return false;
      } else {
        console.log('\n' + message);
        if (response.response?.details) {
          console.log(pc.red(pc.bold(response.response?.details)));
        }
      }
      program.error(logSymbols.error + pc.red(' Schema check failed.'));
      break;
    }
    default: {
      const message = 'Failed to perform the check operation.';
      if (shouldOutputJson) {
        await jsonBuilder
          .setCode(EnumStatusCode.ERR)
          .setMessage(message)
          .setDetails(response.response?.details)
          .setStatus(false)
          .write();
        console.log(JSON.stringify(jsonBuilder.build()));
        return false;
      } else {
        console.log('\nFailed to perform the check operation.');
      }

      if (response.response?.details && !shouldOutputJson) {
        console.log(pc.red(pc.bold(response.response?.details)));
      }

      program.error(logSymbols.error + pc.red(' Schema check failed.'));
    }
  }
};
