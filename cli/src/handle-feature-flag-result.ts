import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
// eslint-disable-next-line import/named
import { Ora } from 'ora';
import Table from 'cli-table3';
import pc from 'picocolors';
import { CompositionError, DeploymentError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export const handleFeatureFlagResult = ({
  responseCode,
  responseDetails,
  compositionErrors,
  deploymentErrors,
  spinner,
  successMessage,
  subgraphCompositionBaseErrorMessage,
  subgraphCompositionDetailedErrorMessage,
  deploymentErrorMessage,
  defaultErrorMessage,
}: {
  responseCode: EnumStatusCode | undefined;
  responseDetails: string | undefined;
  compositionErrors: CompositionError[];
  deploymentErrors: DeploymentError[];
  spinner: Ora;
  successMessage: string;
  subgraphCompositionBaseErrorMessage: string;
  subgraphCompositionDetailedErrorMessage: string;
  deploymentErrorMessage: string;
  defaultErrorMessage: string;
}) => {
  switch (responseCode) {
    case EnumStatusCode.OK: {
      spinner.succeed(successMessage);
      break;
    }
    case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
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

      break;
    }
    case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
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

      break;
    }
    default: {
      spinner.fail(defaultErrorMessage);
      if (responseDetails) {
        console.log(pc.red(pc.bold(responseDetails)));
      }
      throw new Error(defaultErrorMessage);
    }
  }
};
