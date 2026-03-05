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

export const handleCheckResult = ({
  response,
  rowLimit,
  shouldOutputJson,
}: {
  response: CheckSubgraphSchemaResponse;
  rowLimit: number;
  shouldOutputJson?: boolean;
}) => {
  let success = false;
  let finalStatement = '';
  const json: JsonOutputDescriptor = {
    status: 'error',
    rowLimit,
    code: EnumStatusCode.ERR,
  };

  let studioCheckDestination = '';
  if (response.checkId && response.checkedFederatedGraphs.length > 0) {
    const url = `${config.webURL}/${
      response.checkedFederatedGraphs[0].organizationSlug
    }/${response.checkedFederatedGraphs[0].namespace}/graph/${response.checkedFederatedGraphs[0].name}/checks/${response.checkId}`;
    json.url = url;
    studioCheckDestination = `${pc.bold('Open in studio')}: ${url}`;
  }

  switch (response.response?.code) {
    case EnumStatusCode.OK: {
      if (response.proposalMatchMessage) {
        if (shouldOutputJson) {
          json.proposals = {
            success: false,
            message: response.proposalMatchMessage,
          };
        } else {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(response.proposalMatchMessage));
        }
      }

      if (
        response.nonBreakingChanges.length === 0 &&
        response.breakingChanges.length === 0 &&
        response.compositionErrors.length === 0 &&
        response.lintErrors.length === 0 &&
        response.lintWarnings.length === 0 &&
        response.graphPruneErrors.length === 0 &&
        response.graphPruneWarnings.length === 0 &&
        (response.isCheckExtensionSkipped ?? true)
      ) {
        if (shouldOutputJson) {
          json.proposals ??= {
            success: true,
            message: 'Detected no changes. Detected no lint issues. Detected no graph pruning issues.',
          };
          json.status = 'success';
          console.log(JSON.stringify(json));
          return true;
        } else {
          console.log(
            `\nDetected no changes.\nDetected no lint issues.\nDetected no graph pruning issues.\n\n${studioCheckDestination}\n`,
          );
          success = true;
        }

        break;
      }

      if (!shouldOutputJson) {
        console.log(`\nChecking the proposed schema`);
      }

      // No operations usage stats mean the check was not performed against any live traffic
      if (response.operationUsageStats) {
        json.traffic = {
          success: false,
          message: '',
          isLinkedToTargetSubgraph: false,
        };

        if (response.operationUsageStats.totalOperations === 0 && !response.clientTrafficCheckSkipped) {
          // Composition errors are still considered failures, otherwise we can consider this a success
          // because no operations were affected by the change
          success =
            response.compositionErrors.length === 0 &&
            response.lintErrors.length === 0 &&
            response.graphPruneErrors.length === 0;
          const message = 'No operations were affected by this schema change.';

          if (shouldOutputJson) {
            json.traffic = {
              ...json?.traffic,
              success: true,
              isLinkedToTargetSubgraph: false,
              message,
            };
          } else {
            console.log(message);
          }

          finalStatement = `This schema change didn't affect any operations from existing client traffic.`;
        } else if (
          response.operationUsageStats.totalOperations === response.operationUsageStats.safeOperations &&
          !response.clientTrafficCheckSkipped
        ) {
          // This is also a success because changes to these operations were marked as safe
          success =
            response.compositionErrors.length === 0 &&
            response.lintErrors.length === 0 &&
            response.graphPruneErrors.length === 0;
          const message = `${response.operationUsageStats.totalOperations} operations were considered safe due to overrides.`;

          if (shouldOutputJson) {
            json.traffic = {
              ...json?.traffic,
              success: true,
              isLinkedToTargetSubgraph: false,
              message,
            };
          } else {
            console.log(message);
          }

          finalStatement = `This schema change affected operations with safe overrides.`;
        } else {
          // Composition and breaking errors are considered failures because operations were affected by the change
          success =
            response.breakingChanges.length === 0 &&
            response.compositionErrors.length === 0 &&
            response.lintErrors.length === 0 &&
            response.graphPruneErrors.length === 0;

          const { breakingChanges, operationUsageStats, clientTrafficCheckSkipped } = response;
          const { totalOperations, safeOperations, firstSeenAt, lastSeenAt } = operationUsageStats;

          if (breakingChanges.length > 0) {
            json.changes = {
              ...json.changes,
              breaking: {
                ...(json.changes?.breaking ?? []),
                ...breakingChanges,
              },
              nonBreaking: {
                ...(json.changes?.nonBreaking ?? []),
              },
            };
            json.operationUsageStats ??= operationUsageStats;

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

            if (!shouldOutputJson) {
              console.log(warningMessage.join(''));
            }

            finalStatement = `This check has encountered ${pc.bold(`${breakingChanges.length}`)} breaking changes${
              clientTrafficCheckSkipped ? `.` : ` that would break operations from existing client traffic.`
            }`;
          }
        }
      }

      if (response.nonBreakingChanges.length > 0 || response.breakingChanges.length > 0) {
        if (!shouldOutputJson) {
          console.log('\nDetected the following changes:');
        }

        const changesTable = new Table({
          head: [pc.bold(pc.white('CHANGE')), pc.bold(pc.white('TYPE')), pc.bold(pc.white('DESCRIPTION'))],
          wordWrap: true,
        });

        if (response.breakingChanges.length > 0) {
          json.changes = {
            ...json.changes,
            breaking: {
              ...(json.changes?.breaking ?? []),
              ...response.breakingChanges,
            },
            nonBreaking: {
              ...(json.changes?.nonBreaking ?? []),
            },
          };

          for (const breakingChange of response.breakingChanges) {
            changesTable.push([
              `${logSymbols.error} ${pc.red('BREAKING')}`,
              breakingChange.changeType,
              breakingChange.message,
            ]);
          }
        }

        if (response.nonBreakingChanges.length > 0) {
          json.changes = {
            breaking: {
              ...(json.changes?.breaking ?? []),
            },
            nonBreaking: {
              ...(json.changes?.nonBreaking ?? []),
              ...response.nonBreakingChanges,
            },
          };

          for (const nonBreakingChange of response.nonBreakingChanges) {
            changesTable.push([
              `${logSymbols.success} NON-BREAKING`,
              nonBreakingChange.changeType,
              nonBreakingChange.message,
            ]);
          }
        }

        if (!shouldOutputJson) {
          console.log(changesTable.toString());
        }
      }

      if (response.compositionErrors.length > 0) {
        json.composition = {
          ...json.composition,
          success: false,
          errors: {
            ...(json.composition?.errors ?? []),
            ...response.compositionErrors,
          },
          warnings: {
            ...(json.composition?.warnings ?? []),
          },
        };

        const compositionErrorsTable = new Table({
          head: [pc.bold(pc.white('GRAPH_NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('ERROR_MESSAGE'))],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        if (!shouldOutputJson) {
          console.log(pc.red('\nDetected composition errors:'));
        }

        for (const compositionError of response.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.message,
          ]);
        }
        if (!shouldOutputJson) {
          console.log(compositionErrorsTable.toString());
        }
      }

      if (response.compositionWarnings.length > 0) {
        json.composition = {
          ...json.composition,
          success: false,
          errors: {
            ...(json.composition?.errors ?? []),
          },
          warnings: {
            ...(json.composition?.warnings ?? []),
            ...response.compositionWarnings,
          },
        };

        if (!shouldOutputJson) {
          console.log(pc.yellow(`\nDetected composition warnings:`));
        }

        const compositionWarningsTable = new Table({
          head: [pc.bold(pc.white('GRAPH_NAME')), pc.bold(pc.white('NAMESPACE')), pc.bold(pc.white('WARNING_MESSAGE'))],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        for (const compositionWarning of response.compositionWarnings) {
          compositionWarningsTable.push([
            compositionWarning.federatedGraphName,
            compositionWarning.namespace,
            compositionWarning.message,
          ]);
        }

        if (!shouldOutputJson) {
          console.log(compositionWarningsTable.toString());
        }
      }

      if (response.lintErrors.length > 0 || response.lintWarnings.length > 0) {
        json.lint = {
          ...json.lint,
          success: false,
          errors: {
            ...(json.lint?.errors ?? []),
            ...response.lintErrors,
          },
          warnings: {
            ...(json.lint?.warnings ?? []),
            ...response.lintWarnings,
          },
        };

        if (!shouldOutputJson) {
          console.log('\nDetected lint issues:');
        }

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
        if (!shouldOutputJson) {
          console.log(lintIssuesTable.toString());
        }
      }

      if (response.graphPruneErrors.length > 0 || response.graphPruneWarnings.length > 0) {
        json.graphPrune = {
          ...json.graphPrune,
          success: false,
          isLinkedToTargetSubgraph: false,
          errors: {
            ...(json.graphPrune?.errors ?? []),
            ...response.graphPruneErrors,
          },
          warnings: {
            ...(json.graphPrune?.warnings ?? []),
            ...response.graphPruneWarnings,
          },
        };

        if (!shouldOutputJson) {
          console.log('\nDetected graph pruning issues:');
        }

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
        if (!shouldOutputJson) {
          console.log(graphPruningIssuesTable.toString());
        }
      }

      if (response.isLinkedTrafficCheckFailed || response.isLinkedPruningCheckFailed) {
        finalStatement += success
          ? `\n\n But this schema change has been linked to a target subgraph and the target subgraph check has failed.`
          : `\n\n This schema change has been linked to a target subgraph and the target subgraph check has failed.`;

        if (response.isLinkedTrafficCheckFailed) {
          const message = 'The target subgraph check has failed because of client traffic issues.';
          finalStatement += `\n\n ${message}`;

          json.traffic = {
            ...json.traffic,
            success: false,
            isLinkedToTargetSubgraph: response.isLinkedTrafficCheckFailed,
            message: json.traffic?.message ?? message,
          };
        }

        if (response.isLinkedPruningCheckFailed) {
          json.graphPrune = {
            ...json.graphPrune,
            success: false,
            isLinkedToTargetSubgraph: response.isLinkedPruningCheckFailed,
            errors: {
              ...(json.graphPrune?.errors ?? []),
            },
            warnings: {
              ...(json.graphPrune?.warnings ?? []),
            },
          };

          finalStatement += `\n\n The target subgraph check has failed because of graph pruning issues.`;
        }
        success = false;
      }

      if (response.checkExtensionErrorMessage) {
        const message = `Subgraph extension check failed with message: ${response.checkExtensionErrorMessage}`;

        json.extensions = {
          ...json.extensions,
          success: false,
          message,
        };

        success = false;
        finalStatement += `\n${logSymbols.error} ${message}`;
      }

      let moreEntriesAvailableMessage = '';
      if (response.counts) {
        const hasExceeded =
          response.counts.lintWarnings + response.counts.lintErrors > rowLimit ||
          response.counts.breakingChanges + response.counts.nonBreakingChanges > rowLimit ||
          response.counts.graphPruneErrors + response.counts.graphPruneWarnings > rowLimit ||
          response.counts.compositionErrors > rowLimit ||
          response.counts.compositionWarnings > rowLimit;

        json.exceededRowLimit = hasExceeded;

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

      if (shouldOutputJson) {
        json.status = success ? 'success' : 'error';
        json.message = finalStatement;

        console.log(JSON.stringify(json));

        return;
      }

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
      break;
    }
    case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
      const message = 'Error: Proposal match failed';
      if (shouldOutputJson) {
        json.code = EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL;
        json.details = response.proposalMatchMessage;
        json.message = message;
        json.status = 'error';
        console.log(JSON.stringify(json));
        return false;
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
      success = false;
      break;
    }
    case EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA: {
      const message =
        'Check has failed early because the schema could not be built. Please ensure that the schema is valid GraphQL and try again.';
      if (shouldOutputJson) {
        json.code = EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA;
        json.details = response.response?.details;
        json.message = message;
        json.status = 'error';
        console.log(JSON.stringify(json));
        return;
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
        json.code = EnumStatusCode.ERR;
        json.message = message;
        json.details = response.response?.details;
        json.status = 'error';
        console.log(JSON.stringify(json));
        return;
      } else {
        console.log('\nFailed to perform the check operation.');
      }

      if (response.response?.details) {
        console.log(pc.red(pc.bold(response.response?.details)));
      }

      program.error(logSymbols.error + pc.red(' Schema check failed.'));
    }
  }

  json.status = success ? 'success' : 'error';

  return success;
};
