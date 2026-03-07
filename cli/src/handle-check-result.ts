import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  CheckSubgraphSchemaResponse,
  CheckOperationUsageStats,
  CompositionError,
  GraphPruningIssue,
  LintIssue,
  SchemaChange,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Table from 'cli-table3';
import { program } from 'commander';
import logSymbols from 'log-symbols';
import pc from 'picocolors';
import { config } from './core/config.js';

export type JsonOutputDescriptor = {
  status: 'error' | 'success';
  code: EnumStatusCode;
  details?: string;
  message?: string;
  url?: string;
  proposals?: {
    success: boolean;
    message: string;
  };
  traffic?: {
    success: boolean;
    isLinkedToTargetSubgraph: boolean;
    message: string;
  };
  changes?: {
    breaking: SchemaChange[];
    nonBreaking: SchemaChange[];
  };
  composition?: {
    success: boolean;
    errors: CompositionError[];
    warnings: CompositionError[];
  };
  lint?: {
    success: boolean;
    errors: LintIssue[];
    warnings: LintIssue[];
  };
  graphPrune?: {
    success: boolean;
    isLinkedToTargetSubgraph: boolean;
    errors: GraphPruningIssue[];
    warnings: GraphPruningIssue[];
  };
  extensions?: {
    success: boolean;
    message: string;
  };
  exceededRowLimit?: boolean;
  rowLimit: number;
  operationUsageStats?: CheckOperationUsageStats;
};

class JsonOutputBuilder {
  private readonly data: JsonOutputDescriptor;

  constructor(code: EnumStatusCode, rowLimit: number) {
    this.data = { status: 'error', code, rowLimit };
  }

  setUrl(url: string): this {
    this.data.url = url;
    return this;
  }

  setCode(code: EnumStatusCode): this {
    this.data.code = code;
    return this;
  }

  setStatus(success: boolean): this {
    this.data.status = success ? 'success' : 'error';
    return this;
  }

  setMessage(message: string): this {
    this.data.message = message;
    return this;
  }

  setDetails(details: string | undefined): this {
    this.data.details = details;
    return this;
  }

  setProposals(success: boolean, message: string): this {
    this.data.proposals = { success, message };
    return this;
  }

  initProposals(success: boolean, message: string): this {
    this.data.proposals ??= { success, message };
    return this;
  }

  setTraffic(success: boolean, isLinkedToTargetSubgraph: boolean, message: string): this {
    this.data.traffic = { success, isLinkedToTargetSubgraph, message };
    return this;
  }

  markTrafficLinkedFailed(isLinked: boolean, fallbackMessage: string): this {
    this.data.traffic = {
      ...this.data.traffic,
      success: false,
      isLinkedToTargetSubgraph: isLinked,
      message: this.data.traffic?.message ?? fallbackMessage,
    };
    return this;
  }

  addBreakingChanges(changes: SchemaChange[]): this {
    this.data.changes = {
      ...this.data.changes,
      breaking: [...(this.data.changes?.breaking ?? []), ...changes],
      nonBreaking: [...(this.data.changes?.nonBreaking ?? [])],
    };
    return this;
  }

  addNonBreakingChanges(changes: SchemaChange[]): this {
    this.data.changes = {
      breaking: [...(this.data.changes?.breaking ?? [])],
      nonBreaking: [...(this.data.changes?.nonBreaking ?? []), ...changes],
    };
    return this;
  }

  setOperationUsageStats(stats: CheckOperationUsageStats): this {
    this.data.operationUsageStats ??= stats;
    return this;
  }

  addCompositionErrors(errors: CompositionError[]): this {
    this.data.composition = {
      ...this.data.composition,
      success: false,
      errors: [...(this.data.composition?.errors ?? []), ...errors],
      warnings: [...(this.data.composition?.warnings ?? [])],
    };
    return this;
  }

  addCompositionWarnings(warnings: CompositionError[]): this {
    this.data.composition = {
      ...this.data.composition,
      success: false,
      errors: [...(this.data.composition?.errors ?? [])],
      warnings: [...(this.data.composition?.warnings ?? []), ...warnings],
    };
    return this;
  }

  addLintErrors(errors: LintIssue[]): this {
    this.data.lint = {
      ...this.data.lint,
      success: false,
      errors: [...(this.data.lint?.errors ?? []), ...errors],
      warnings: [...(this.data.lint?.warnings ?? [])],
    };
    return this;
  }

  addLintWarnings(warnings: LintIssue[]): this {
    this.data.lint = {
      ...this.data.lint,
      success: false,
      errors: [...(this.data.lint?.errors ?? [])],
      warnings: [...(this.data.lint?.warnings ?? []), ...warnings],
    };
    return this;
  }

  addGraphPruneErrors(errors: GraphPruningIssue[]): this {
    this.data.graphPrune = {
      ...this.data.graphPrune,
      success: false,
      isLinkedToTargetSubgraph: this.data.graphPrune?.isLinkedToTargetSubgraph ?? false,
      errors: [...(this.data.graphPrune?.errors ?? []), ...errors],
      warnings: [...(this.data.graphPrune?.warnings ?? [])],
    };
    return this;
  }

  addGraphPruneWarnings(warnings: GraphPruningIssue[]): this {
    this.data.graphPrune = {
      ...this.data.graphPrune,
      success: false,
      isLinkedToTargetSubgraph: this.data.graphPrune?.isLinkedToTargetSubgraph ?? false,
      errors: [...(this.data.graphPrune?.errors ?? [])],
      warnings: [...(this.data.graphPrune?.warnings ?? []), ...warnings],
    };
    return this;
  }

  markGraphPruneLinkedFailed(isLinked: boolean): this {
    this.data.graphPrune = {
      ...this.data.graphPrune,
      success: false,
      isLinkedToTargetSubgraph: isLinked,
      errors: [...(this.data.graphPrune?.errors ?? [])],
      warnings: [...(this.data.graphPrune?.warnings ?? [])],
    };
    return this;
  }

  setExtensionError(message: string): this {
    this.data.extensions = { ...this.data.extensions, success: false, message };
    return this;
  }

  setExceededRowLimit(exceeded: boolean): this {
    this.data.exceededRowLimit = exceeded;
    return this;
  }

  build(): JsonOutputDescriptor {
    return this.data;
  }
}

// operationUsageStats is required — caller must guard with `if (response.operationUsageStats)` before calling
const handleTrafficCheck = (
  response: CheckSubgraphSchemaResponse,
  operationUsageStats: CheckOperationUsageStats,
  jsonBuilder: JsonOutputBuilder,
  shouldOutputJson: boolean,
): { success: boolean; finalStatement: string } => {
  jsonBuilder.setTraffic(false, false, '');

  const { clientTrafficCheckSkipped, compositionErrors, lintErrors, graphPruneErrors, breakingChanges } = response;
  const { totalOperations, safeOperations, firstSeenAt, lastSeenAt } = operationUsageStats;

  if (totalOperations === 0 && !clientTrafficCheckSkipped) {
    // Composition errors are still considered failures, otherwise we can consider this a success
    // because no operations were affected by the change
    const success = compositionErrors.length === 0 && lintErrors.length === 0 && graphPruneErrors.length === 0;
    const message = 'No operations were affected by this schema change.';
    jsonBuilder.setTraffic(true, false, message);
    if (!shouldOutputJson) {
      console.log(message);
    }
    return { success, finalStatement: `This schema change didn't affect any operations from existing client traffic.` };
  }

  if (totalOperations === safeOperations && !clientTrafficCheckSkipped) {
    // This is also a success because changes to these operations were marked as safe
    const success = compositionErrors.length === 0 && lintErrors.length === 0 && graphPruneErrors.length === 0;
    const message = `${totalOperations} operations were considered safe due to overrides.`;
    jsonBuilder.setTraffic(true, false, message);
    if (!shouldOutputJson) {
      console.log(message);
    }
    return { success, finalStatement: `This schema change affected operations with safe overrides.` };
  }

  // Composition and breaking errors are considered failures because operations were affected
  const success =
    breakingChanges.length === 0 &&
    compositionErrors.length === 0 &&
    lintErrors.length === 0 &&
    graphPruneErrors.length === 0;
  let finalStatement = '';

  if (breakingChanges.length > 0) {
    jsonBuilder.addBreakingChanges(breakingChanges);
    jsonBuilder.setOperationUsageStats(operationUsageStats);

    const warningMessage = [logSymbols.warning, ` Found ${pc.bold(breakingChanges.length)} breaking changes.`];
    if (totalOperations > 0) {
      warningMessage.push(`${pc.bold(totalOperations - safeOperations)} operations impacted.`);
    }
    if (safeOperations > 0) {
      warningMessage.push(`In addition, ${safeOperations} operations marked safe due to overrides.`);
    }
    if (!clientTrafficCheckSkipped) {
      warningMessage.push(
        `\nFound client activity between ${pc.underline(new Date(firstSeenAt).toLocaleString())} and ${pc.underline(new Date(lastSeenAt).toLocaleString())}.`,
      );
    }
    if (!shouldOutputJson) {
      console.log(warningMessage.join(''));
    }

    finalStatement = `This check has encountered ${pc.bold(`${breakingChanges.length}`)} breaking changes${
      clientTrafficCheckSkipped ? `.` : ` that would break operations from existing client traffic.`
    }`;
  }

  return { success, finalStatement };
};

const handleSchemaChanges = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonOutputBuilder,
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

  console.log('\nDetected the following changes:');
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

const handleCompositionErrors = (
  response: CheckSubgraphSchemaResponse,
  jsonBuilder: JsonOutputBuilder,
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
  jsonBuilder: JsonOutputBuilder,
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
  jsonBuilder: JsonOutputBuilder,
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
  jsonBuilder: JsonOutputBuilder,
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
  jsonBuilder: JsonOutputBuilder,
  currentSuccess: boolean,
): string => {
  let additionalStatement = currentSuccess
    ? `\n\n But this schema change has been linked to a target subgraph and the target subgraph check has failed.`
    : `\n\n This schema change has been linked to a target subgraph and the target subgraph check has failed.`;

  if (response.isLinkedTrafficCheckFailed) {
    const message = 'The target subgraph check has failed because of client traffic issues.';
    additionalStatement += `\n\n ${message}`;
    jsonBuilder.markTrafficLinkedFailed(response.isLinkedTrafficCheckFailed, message);
  }

  if (response.isLinkedPruningCheckFailed) {
    jsonBuilder.markGraphPruneLinkedFailed(response.isLinkedPruningCheckFailed);
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
  jsonBuilder: JsonOutputBuilder;
  rowLimit: number;
  shouldOutputJson?: boolean;
  studioCheckDestination: string;
}): { success: boolean } => {
  let success = false;
  let finalStatement = '';

  // Proposal match warning — always build json, conditionally print
  if (response.proposalMatchMessage) {
    jsonBuilder.setProposals(false, response.proposalMatchMessage);
    if (!shouldOutputJson) {
      console.log(pc.yellow(`Warning: Proposal match failed`));
      console.log(pc.yellow(response.proposalMatchMessage));
    }
  }

  // Early exit: nothing to report
  const hasNoIssues =
    response.nonBreakingChanges.length === 0 &&
    response.breakingChanges.length === 0 &&
    response.compositionErrors.length === 0 &&
    response.lintErrors.length === 0 &&
    response.lintWarnings.length === 0 &&
    response.graphPruneErrors.length === 0 &&
    response.graphPruneWarnings.length === 0 &&
    (response.isCheckExtensionSkipped ?? true);

  if (hasNoIssues) {
    jsonBuilder.initProposals(true, 'Detected no changes. Detected no lint issues. Detected no graph pruning issues.');
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
      response.counts.compositionWarnings > rowLimit;

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

export const handleCheckResult = ({
  response,
  rowLimit,
  shouldOutputJson,
}: {
  response: CheckSubgraphSchemaResponse;
  rowLimit: number;
  shouldOutputJson?: boolean;
}): boolean => {
  const jsonBuilder = new JsonOutputBuilder(EnumStatusCode.ERR, rowLimit);

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
        console.log(JSON.stringify(jsonBuilder.build()));
      }
      return success;
    }
    case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
      const message = 'Error: Proposal match failed';
      if (shouldOutputJson) {
        jsonBuilder
          .setCode(EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL)
          .setDetails(response.proposalMatchMessage)
          .setMessage(message)
          .setStatus(false);
        console.log(JSON.stringify(jsonBuilder.build()));
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
        jsonBuilder
          .setCode(EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA)
          .setDetails(response.response?.details)
          .setMessage(message)
          .setStatus(false);
        console.log(JSON.stringify(jsonBuilder.build()));
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
        jsonBuilder
          .setCode(EnumStatusCode.ERR)
          .setMessage(message)
          .setDetails(response.response?.details)
          .setStatus(false);
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
