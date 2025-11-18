/**
 * This file is intended to be used with a worker thread.
 * In watch mode changes aren't immediately applied. You have to rebuild the project with tsc before changes are applied.
 */
import { randomUUID } from 'node:crypto';
import { MessagePort } from 'node:worker_threads';
import { PlainMessage } from '@bufbuild/protobuf';
import { CompositionError, CompositionWarning } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ContractTagOptions, FederationResult, FederationResultWithContracts } from '@wundergraph/composition';
import { getFederationResultWithPotentialContracts } from '../core/util.js';
import { CompositionOptions, FederatedGraphDTO } from '../types/index.js';
import {
  buildRouterExecutionConfig,
  ComposedFederatedGraph,
  CompositionDeployResult,
  mapResultToComposedGraph,
} from '../core/composition/composer.js';
import { SubgraphsToCompose } from '../core/repositories/FeatureFlagRepository.js';
import { unsuccessfulBaseCompositionError } from '../core/errors/errors.js';

export interface Inputs {
  federatedGraph: FederatedGraphDTO;
  subgraphsToCompose: SubgraphsToCompose;
  tagOptionsByContractName: Map<string, ContractTagOptions>;
  compositionOptions?: CompositionOptions;
  port: MessagePort;
}

export interface ContractGraph {
  composedContract: ComposedFederatedGraph;
  contractResultSuccess: boolean;
  contractGraphId: string;
  contractSchemaVersionId: `${string}-${string}-${string}-${string}-${string}`;
  // contractRouterExecutionConfig?: RouterConfig;
}

export interface Outputs {
  resultSuccess: boolean;
  composedGraph: ComposedFederatedGraph;
  federatedSchemaVersionId: `${string}-${string}-${string}-${string}-${string}`;
  schemaVersionId: string;
  // routerExecutionConfig?: RouterConfig;
  allCompositionErrors: PlainMessage<CompositionError>[];
  allCompositionWarnings: PlainMessage<CompositionWarning>[];
  contractGraphs: ContractGraph[];
}

export interface BaseMessage {
  composedGraph: ComposedFederatedGraph;
  contractNames: string[];
  federatedSchemaVersionId: `${string}-${string}-${string}-${string}-${string}`;
  // routerExecutionConfig?: RouterConfig;
}

export interface BaseResult {
  compositionDeployResult: CompositionDeployResult;
  contractGraphs: Map<string, FederatedGraphDTO>;
}

export default function ({
  federatedGraph,
  subgraphsToCompose,
  tagOptionsByContractName,
  compositionOptions,
  port,
}: Inputs): Promise<Outputs> {
  return new Promise((resolve) => {
    const allCompositionErrors: PlainMessage<CompositionError>[] = [];
    const allCompositionWarnings: PlainMessage<CompositionWarning>[] = [];

    const result: FederationResult | FederationResultWithContracts = getFederationResultWithPotentialContracts(
      federatedGraph,
      subgraphsToCompose,
      tagOptionsByContractName,
      compositionOptions,
    );

    if (!result.success) {
      allCompositionErrors.push(
        ...result.errors.map((e) => ({
          federatedGraphName: federatedGraph.name,
          namespace: federatedGraph.namespace,
          message: e.message,
          featureFlag: subgraphsToCompose.featureFlagName || '',
        })),
      );
    }

    allCompositionWarnings.push(
      ...result.warnings.map((w) => ({
        federatedGraphName: federatedGraph.name,
        namespace: federatedGraph.namespace,
        message: w.message,
        featureFlag: subgraphsToCompose.featureFlagName || '',
      })),
    );

    if (!subgraphsToCompose.isFeatureFlagComposition && !result.success && !federatedGraph.contract) {
      allCompositionErrors.push(unsuccessfulBaseCompositionError(federatedGraph.name, federatedGraph.namespace));
    }

    const composedGraph = mapResultToComposedGraph(federatedGraph, subgraphsToCompose.subgraphs, result);

    const federatedSchemaVersionId = randomUUID();

    const routerExecutionConfig = buildRouterExecutionConfig(
      composedGraph,
      federatedSchemaVersionId,
      federatedGraph.routerCompatibilityVersion,
    );

    const contractNames: string[] = [];

    if ('federationResultByContractName' in result) {
      for (const [contractName, _] of result.federationResultByContractName) {
        contractNames.push(contractName);
      }
    }

    const message: BaseMessage = {
      composedGraph,
      federatedSchemaVersionId,
      // routerExecutionConfig,
      contractNames,
    };

    port.postMessage(message);

    port.on('message', (baseResult: BaseResult) => {
      if (!result.success || !baseResult.compositionDeployResult.schemaVersionId || !routerExecutionConfig) {
        const outputs: Outputs = {
          resultSuccess: result.success,
          composedGraph,
          federatedSchemaVersionId,
          schemaVersionId: baseResult.compositionDeployResult.schemaVersionId,
          // routerExecutionConfig,
          contractGraphs: [],
          allCompositionErrors,
          allCompositionWarnings,
        };
        resolve(outputs);
      }

      const contractGraphs: ContractGraph[] = [];

      if ('federationResultByContractName' in result) {
        for (const [contractName, contractGraph] of baseResult.contractGraphs.entries()) {
          const contractResult = result.federationResultByContractName.get(contractName)!; // This must always exist, as the `baseResult.contractGraphs` is generated from `message.contractNames`.
          if (!contractResult.success) {
            allCompositionErrors.push(
              ...contractResult.errors.map((e) => ({
                federatedGraphName: contractGraph.name,
                namespace: contractGraph.namespace,
                message: e.message,
                featureFlag: subgraphsToCompose.featureFlagName,
              })),
            );
          }

          allCompositionWarnings.push(
            ...contractResult.warnings.map((w) => ({
              federatedGraphName: contractGraph.name,
              namespace: contractGraph.namespace,
              message: w.message,
              featureFlag: subgraphsToCompose.featureFlagName,
            })),
          );

          const composedContract = mapResultToComposedGraph(
            contractGraph,
            subgraphsToCompose.subgraphs,
            contractResult,
          );

          const contractSchemaVersionId = randomUUID();

          const contractRouterExecutionConfig = buildRouterExecutionConfig(
            composedContract,
            contractSchemaVersionId,
            federatedGraph.routerCompatibilityVersion,
          );

          contractGraphs.push({
            composedContract,
            contractResultSuccess: contractResult.success,
            contractGraphId: contractGraph.id,
            contractSchemaVersionId,
            // contractRouterExecutionConfig,
          });
        }
      }

      const outputs: Outputs = {
        resultSuccess: result.success,
        composedGraph,
        federatedSchemaVersionId,
        schemaVersionId: baseResult.compositionDeployResult.schemaVersionId,
        // routerExecutionConfig,
        contractGraphs,
        allCompositionErrors,
        allCompositionWarnings,
      };

      resolve(outputs);
    });
  });
}
