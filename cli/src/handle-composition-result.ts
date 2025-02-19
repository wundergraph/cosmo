import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
// eslint-disable-next-line import/named
import { Ora } from 'ora';
import Table from 'cli-table3';
import pc from 'picocolors';
import {
  CompositionError,
  CompositionWarning,
  DeploymentError,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SubgraphCommandJsonOutput } from './core/types/types.js';

export const handleCompositionResult = ({
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
  shouldOutputJson?: boolean;
  suppressWarnings?: boolean;
}) => {
  switch (responseCode) {
    case EnumStatusCode.OK: {
      if (shouldOutputJson) {
        const successMessageJson: SubgraphCommandJsonOutput = {
          status: 'success',
          message: successMessage,
          compositionErrors,
          deploymentErrors,
        };
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

  if (!suppressWarnings && compositionWarnings.length > 0) {
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
};
