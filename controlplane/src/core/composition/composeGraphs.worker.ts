/**
 * Self-contained worker entry for federated graph composition.
 *
 * Keep this file independent from local controlplane runtime helpers where
 * possible. The worker returns plain `Serialized*` payloads so the thread
 * boundary stays stable even when richer in-process models change.
 */
import { randomUUID } from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  newContractTagOptionsFromArrays,
  ROUTER_COMPATIBILITY_VERSIONS,
  Warning,
} from '@wundergraph/composition';
import { buildRouterConfig, SubgraphKind } from '@wundergraph/cosmo-shared';
import { GRPCMapping, ImageReference, RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { parse } from 'graphql';
import type {
  CompositionOptions,
  ContractTagOptions,
  FederationResult,
  FederationResultWithContracts,
  FieldConfiguration,
  Subgraph,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';
import type {
  ComposedSubgraph as BaseComposedSubgraph,
  ComposedSubgraphGRPC,
  ComposedSubgraphPlugin,
} from '@wundergraph/cosmo-shared';
import type { FederatedGraphDTO, SubgraphDTO } from '../../types/index.js';
import type {
  ComposeGraphsTaskInput,
  ComposeGraphsTaskResult,
  SerializedContractCompositionArtifact,
  SerializedComposedGraphArtifact,
} from './composeGraphs.types.js';

type ComposedSubgraph = (BaseComposedSubgraph | ComposedSubgraphPlugin | ComposedSubgraphGRPC) & {
  targetId: string;
  isFeatureSubgraph: boolean;
  schemaVersionId: string;
};

type ComposedFederatedGraph = {
  id: string;
  targetID: string;
  name: string;
  namespace: string;
  namespaceId: string;
  composedSchema?: string;
  errors: Error[];
  subgraphs: ComposedSubgraph[];
  fieldConfigurations: FieldConfiguration[];
  federatedClientSchema?: string;
  shouldIncludeClientSchema?: boolean;
  warnings: Warning[];
};

function validateRouterCompatibilityVersion(version: string): SupportedRouterCompatibilityVersion {
  const castVersion = version as SupportedRouterCompatibilityVersion;
  if (!ROUTER_COMPATIBILITY_VERSIONS.has(castVersion)) {
    throw new Error(
      `Router compatibility version ${version} is not supported by Cosmo.` +
        `Please set one of the following valid versions:\n ` +
        [...ROUTER_COMPATIBILITY_VERSIONS].join(','),
    );
  }

  return castVersion;
}

function composeFederatedGraphWithPotentialContracts(
  subgraphs: Subgraph[],
  tagOptionsByContractName: Map<string, ContractTagOptions>,
  version: string,
  options?: CompositionOptions,
) {
  return federateSubgraphsWithContracts({
    options,
    subgraphs,
    tagOptionsByContractName,
    version: validateRouterCompatibilityVersion(version),
  });
}

function composeFederatedContract(
  subgraphs: Subgraph[],
  contractTagOptions: ContractTagOptions,
  version: string,
  options?: CompositionOptions,
) {
  return federateSubgraphsContract({
    contractTagOptions,
    options,
    subgraphs,
    version: validateRouterCompatibilityVersion(version),
  });
}

function buildRouterExecutionConfig(
  composedGraph: ComposedFederatedGraph,
  federatedSchemaVersionId: string,
  routerCompatibilityVersion: string,
): RouterConfig | undefined {
  if (composedGraph.errors.length > 0 || !composedGraph.composedSchema) {
    return;
  }

  const federatedClientSDL = composedGraph.shouldIncludeClientSchema ? composedGraph.federatedClientSchema || '' : '';

  return buildRouterConfig({
    federatedClientSDL,
    federatedSDL: composedGraph.composedSchema,
    fieldConfigurations: composedGraph.fieldConfigurations,
    routerCompatibilityVersion,
    subgraphs: composedGraph.subgraphs,
    schemaVersionId: federatedSchemaVersionId,
  });
}

function parseGRPCMapping(mappings: string): GRPCMapping {
  try {
    return GRPCMapping.fromJson(JSON.parse(mappings));
  } catch (error) {
    throw new Error(`Failed to parse gRPC mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function subgraphDTOsToComposedSubgraphs(
  organizationId: string,
  subgraphs: SubgraphDTO[],
  result: FederationResult,
): ComposedSubgraph[] {
  return subgraphs.map((subgraph) => {
    const subgraphConfig = result.success ? result.subgraphConfigBySubgraphName.get(subgraph.name) : undefined;
    const schema = subgraphConfig?.schema;
    const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;

    if (subgraph.type === 'grpc_plugin') {
      if (!subgraph.proto?.pluginData) {
        throw new Error(`Subgraph ${subgraph.name} is a plugin but does not have a plugin data`);
      }

      return {
        kind: SubgraphKind.Plugin,
        id: subgraph.id,
        version: subgraph.proto.pluginData.version,
        name: subgraph.name,
        sdl: subgraph.schemaSDL,
        url: subgraph.routingUrl,
        schemaVersionId: subgraph.schemaVersionId,
        targetId: subgraph.targetId,
        isFeatureSubgraph: subgraph.isFeatureSubgraph,
        configurationDataByTypeName,
        schema,
        protoSchema: subgraph.proto.schema,
        mapping: parseGRPCMapping(subgraph.proto.mappings),
        imageReference: new ImageReference({
          repository: `${organizationId}/${subgraph.id}`,
          reference: subgraph.proto.pluginData.version,
        }),
      };
    }

    if (subgraph.type === 'grpc_service') {
      if (!subgraph.proto) {
        throw new Error(`Subgraph ${subgraph.name} is a GRPC service but does not have a proto`);
      }

      return {
        kind: SubgraphKind.GRPC,
        id: subgraph.id,
        name: subgraph.name,
        sdl: subgraph.schemaSDL,
        url: subgraph.routingUrl,
        schemaVersionId: subgraph.schemaVersionId,
        targetId: subgraph.targetId,
        isFeatureSubgraph: subgraph.isFeatureSubgraph,
        configurationDataByTypeName,
        schema,
        protoSchema: subgraph.proto.schema,
        mapping: parseGRPCMapping(subgraph.proto.mappings),
      };
    }

    return {
      kind: SubgraphKind.Standard,
      id: subgraph.id,
      name: subgraph.name,
      targetId: subgraph.targetId,
      isFeatureSubgraph: subgraph.isFeatureSubgraph,
      url: subgraph.routingUrl,
      sdl: subgraph.schemaSDL,
      schemaVersionId: subgraph.schemaVersionId,
      subscriptionUrl: subgraph.subscriptionUrl,
      subscriptionProtocol: subgraph.subscriptionProtocol,
      websocketSubprotocol:
        subgraph.subscriptionProtocol === 'ws' ? subgraph.websocketSubprotocol || 'auto' : undefined,
      configurationDataByTypeName,
      schema,
    };
  });
}

function mapResultToComposedGraph(
  federatedGraph: FederatedGraphDTO,
  subgraphs: SubgraphDTO[],
  result: FederationResult,
): ComposedFederatedGraph {
  return {
    id: federatedGraph.id,
    targetID: federatedGraph.targetId,
    name: federatedGraph.name,
    namespace: federatedGraph.namespace,
    namespaceId: federatedGraph.namespaceId,
    composedSchema: result.success ? printSchemaWithDirectives(result.federatedGraphSchema) : undefined,
    federatedClientSchema: result.success ? printSchemaWithDirectives(result.federatedGraphClientSchema) : undefined,
    shouldIncludeClientSchema: result.success ? result.shouldIncludeClientSchema : false,
    errors: result.success ? [] : result.errors,
    subgraphs: subgraphDTOsToComposedSubgraphs(federatedGraph.organizationId, subgraphs, result),
    fieldConfigurations: result.success ? result.fieldConfigurations : [],
    warnings: result.warnings,
  };
}

function serializeComposedGraphArtifact(
  task: ComposeGraphsTaskInput,
  graph: FederatedGraphDTO,
  subgraphs: SubgraphDTO[],
  result: FederationResult,
): SerializedComposedGraphArtifact {
  const composedGraph = mapResultToComposedGraph(graph, subgraphs, result);
  const routerExecutionConfig = buildRouterExecutionConfig(
    composedGraph,
    randomUUID(),
    task.federatedGraph.routerCompatibilityVersion,
  );

  return {
    success: result.success,
    errors: result.success ? [] : result.errors.map((error) => error.message),
    warnings: result.warnings.map((warning) => ({
      message: warning.message,
      subgraphName: warning.subgraph?.name,
    })),
    composedSchema: composedGraph.composedSchema,
    federatedClientSchema: composedGraph.federatedClientSchema,
    shouldIncludeClientSchema: composedGraph.shouldIncludeClientSchema ?? false,
    subgraphs: composedGraph.subgraphs.map((subgraph) => ({
      id: subgraph.id,
      isFeatureSubgraph: subgraph.isFeatureSubgraph,
      name: subgraph.name,
      schemaVersionId: subgraph.schemaVersionId,
      targetId: subgraph.targetId,
    })),
    routerExecutionConfigJson: routerExecutionConfig?.toJson(),
  };
}

function toCompositionSubgraphs(subgraphs: SubgraphDTO[]) {
  return subgraphs.map((subgraph) => ({
    name: subgraph.name,
    url: subgraph.routingUrl,
    definitions: parse(subgraph.schemaSDL),
  }));
}

export default function composeGraphsInWorker(task: ComposeGraphsTaskInput): ComposeGraphsTaskResult {
  const tagOptionsByContractName = new Map(
    task.tagOptionsByContractName.map((tagOptions) => [
      tagOptions.contractName,
      newContractTagOptionsFromArrays(tagOptions.excludeTags, tagOptions.includeTags),
    ]),
  );

  return {
    results: task.subgraphsToCompose.map((subgraphsToCompose) => {
      const compositionSubgraphs = toCompositionSubgraphs(subgraphsToCompose.subgraphs);

      const result: FederationResult | FederationResultWithContracts = task.federatedGraph.contract
        ? composeFederatedContract(
            compositionSubgraphs,
            newContractTagOptionsFromArrays(
              task.federatedGraph.contract.excludeTags,
              task.federatedGraph.contract.includeTags,
            ),
            task.federatedGraph.routerCompatibilityVersion,
            task.compositionOptions,
          )
        : composeFederatedGraphWithPotentialContracts(
            compositionSubgraphs,
            tagOptionsByContractName,
            task.federatedGraph.routerCompatibilityVersion,
            task.compositionOptions,
          );

      const base = serializeComposedGraphArtifact(task, task.federatedGraph, subgraphsToCompose.subgraphs, result);

      const contracts: SerializedContractCompositionArtifact[] = [];
      if ('federationResultByContractName' in result && result.success) {
        for (const [contractName, contractResult] of result.federationResultByContractName as Map<
          string,
          FederationResult
        >) {
          contracts.push({
            contractName,
            artifact: serializeComposedGraphArtifact(
              task,
              {
                ...task.federatedGraph,
                id: '',
                targetId: '',
                name: contractName,
              },
              subgraphsToCompose.subgraphs,
              contractResult,
            ),
          });
        }
      }

      return {
        isFeatureFlagComposition: subgraphsToCompose.isFeatureFlagComposition,
        featureFlagName: subgraphsToCompose.featureFlagName,
        featureFlagId: subgraphsToCompose.featureFlagId,
        base,
        contracts,
      };
    }),
  };
}
