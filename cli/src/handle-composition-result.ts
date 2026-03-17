import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
// eslint-disable-next-line import/named
import { Ora } from 'ora';
import Table from 'cli-table3';
import pc from 'picocolors';
import {
  CompositionError,
  CompositionWarning,
  DeploymentError,
  SubgraphPublishStats,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SubgraphCommandJsonOutput } from './core/types/types.js';
import { printTruncationWarning } from './utils.js';

export function handleCompositionResult({
  totalErrorCounts,
  responseCode,
  responseDetails,
  compositionErrors,
  compositionWarnings,
  deploymentErrors,
  spinner,
  successMessage,
  subgraphCompositionBaseErrorMessage,
  subgraphCompositionDetailedErrorMessage,
  deploymentErrorMessage,
  defaultErrorMessage,
  shouldOutputJson,
  suppressWarnings,
  failOnCompositionError,
  failOnCompositionErrorMessage,
  failOnAdmissionWebhookError,
  failOnAdmissionWebhookErrorMessage,
}: {
  responseCode: EnumStatusCode | undefined;
  responseDetails: string | undefined;
  compositionErrors: CompositionError[];
  compositionWarnings: CompositionWarning[];
  deploymentErrors: DeploymentError[];
  spinner: Ora;
  successMessage: string;
  subgraphCompositionBaseErrorMessage: string;
  subgraphCompositionDetailedErrorMessage: string;
  deploymentErrorMessage: string;
  defaultErrorMessage: string;
  totalErrorCounts?: SubgraphPublishStats;
  shouldOutputJson?: boolean;
  suppressWarnings?: boolean;
  failOnCompositionError?: boolean;
  failOnCompositionErrorMessage?: string;
  failOnAdmissionWebhookError?: boolean;
  failOnAdmissionWebhookErrorMessage?: string;
}) {
  switch (responseCode) {
    case EnumStatusCode.OK: {
      if (shouldOutputJson) {
        const successMessageJson: SubgraphCommandJsonOutput = {
          status: 'success',
          message: successMessage,
          compositionErrors,
          deploymentErrors,
        };
        if (!suppressWarnings) {
          successMessageJson.compositionWarnings = compositionWarnings;
        }
        console.log(JSON.stringify(successMessageJson));
      } else {
        spinner.succeed(successMessage);
      }
      break;
    }
    case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
      if (shouldOutputJson) {
        const compositionFailedMessageJson: SubgraphCommandJsonOutput = {
          status: 'error',
          message: subgraphCompositionBaseErrorMessage,
          compositionErrors,
          deploymentErrors,
        };
        if (!suppressWarnings) {
          compositionFailedMessageJson.compositionWarnings = compositionWarnings;
        }
        console.log(JSON.stringify(compositionFailedMessageJson));
      } else {
        spinner.fail(subgraphCompositionBaseErrorMessage);

        const compositionErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('FEATURE_FLAG')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 30, 120],
          wordWrap: true,
        });

        console.log(pc.yellow(subgraphCompositionDetailedErrorMessage));
        for (const compositionError of compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.featureFlag || '-',
            compositionError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(compositionErrorsTable.toString());
      }
      if (failOnCompositionError) {
        // Only composition errors were displayed at this point; warnings come after the switch statement
        printTruncationWarning({
          displayedErrorCounts: new SubgraphPublishStats({
            compositionErrors: compositionErrors.length,
            compositionWarnings: 0,
            deploymentErrors: 0,
          }),
          totalErrorCounts,
        });
        console.log(pc.red(pc.bold(failOnCompositionErrorMessage || 'The command failed due to composition errors.')));
        throw new Error(failOnCompositionErrorMessage || 'The command failed due to composition errors.');
      }
      break;
    }
    case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
      if (shouldOutputJson) {
        const deploymentFailedMessageJson: SubgraphCommandJsonOutput = {
          status: 'error',
          message: deploymentErrorMessage,
          compositionErrors,
          deploymentErrors,
        };
        if (!suppressWarnings) {
          deploymentFailedMessageJson.compositionWarnings = compositionWarnings;
        }
        console.log(JSON.stringify(deploymentFailedMessageJson));
      } else {
        spinner.warn(deploymentErrorMessage);

        const deploymentErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        for (const deploymentError of deploymentErrors) {
          deploymentErrorsTable.push([
            deploymentError.federatedGraphName,
            deploymentError.namespace,
            deploymentError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(deploymentErrorsTable.toString());
      }
      if (failOnAdmissionWebhookError) {
        // Only deployment errors were displayed at this point; warnings come after the switch statement
        printTruncationWarning({
          displayedErrorCounts: new SubgraphPublishStats({
            compositionErrors: 0,
            compositionWarnings: 0,
            deploymentErrors: deploymentErrors.length,
          }),
          totalErrorCounts,
        });
        console.log(
          pc.red(pc.bold(failOnAdmissionWebhookErrorMessage || 'The command failed due to admission webhook errors.')),
        );
        throw new Error(failOnAdmissionWebhookErrorMessage || 'The command failed due to admission webhook errors.');
      }
      break;
    }
    default: {
      if (shouldOutputJson) {
        const defaultErrorMessageJson: SubgraphCommandJsonOutput = {
          status: 'error',
          message: defaultErrorMessage,
          compositionErrors,
          deploymentErrors,
          details: responseDetails,
        };
        if (!suppressWarnings) {
          defaultErrorMessageJson.compositionWarnings = compositionWarnings;
        }
        console.log(JSON.stringify(defaultErrorMessageJson));
      } else {
        spinner.fail(defaultErrorMessage);
        if (responseDetails) {
          console.log(pc.red(pc.bold(responseDetails)));
        }
      }
      throw new Error(defaultErrorMessage);
    }
  }

  // Track what was actually displayed
  const displayedWarnings = suppressWarnings ? 0 : compositionWarnings.length;

  if (!shouldOutputJson && !suppressWarnings && compositionWarnings.length > 0) {
    const compositionWarningsTable = new Table({
      head: [
        pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
        pc.bold(pc.white('NAMESPACE')),
        pc.bold(pc.white('FEATURE_FLAG')),
        pc.bold(pc.white('WARNING_MESSAGE')),
      ],
      colWidths: [30, 30, 30, 120],
      wordWrap: true,
    });

    console.log(pc.yellow(`The following warnings were produced while composing the federated graph:`));
    for (const compositionWarning of compositionWarnings) {
      compositionWarningsTable.push([
        compositionWarning.federatedGraphName,
        compositionWarning.namespace,
        compositionWarning.featureFlag || '-',
        compositionWarning.message,
      ]);
    }
    console.log(compositionWarningsTable.toString());
  }

  // Determine what was actually displayed based on the response code
  const displayedErrorCounts = new SubgraphPublishStats({
    compositionErrors: responseCode === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED ? compositionErrors.length : 0,
    compositionWarnings: displayedWarnings,
    deploymentErrors: responseCode === EnumStatusCode.ERR_DEPLOYMENT_FAILED ? deploymentErrors.length : 0,
  });

  printTruncationWarning({ displayedErrorCounts, totalErrorCounts });
}
