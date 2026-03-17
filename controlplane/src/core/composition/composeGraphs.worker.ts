/**
 * Self-contained worker entry for federated graph composition.
 *
 * Keep this file independent from local controlplane runtime helpers where
 * possible. The worker returns plain `Serialized*` payloads so the thread
 * boundary stays stable even when richer in-process models change.
 *
 * IMPORTANT: Avoid adding value imports from local `.ts` files (e.g.
 * `./composition.js`). Tinypool worker threads cannot resolve `.js` imports
 * to `.ts` source files, so only `import type` (which is erased at runtime)
 * is safe for local modules. Value imports from npm packages are fine.
 */
import { randomUUID } from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  newContractTagOptionsFromArrays,
} from '@wundergraph/composition';
import { buildRouterConfig, SubgraphKind } from '@wundergraph/cosmo-shared';
import { GRPCMapping, ImageReference, RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { parse } from 'graphql';
import type { FederationResult, FederationResultWithContracts } from '@wundergraph/composition';
import type { RouterSubgraph } from '@wundergraph/cosmo-shared';
import type { SubgraphDTO } from '../../types/index.js';
import type {
  ComposeGraphsTaskInput,
  ComposeGraphsTaskResult,
  SerializedContractCompositionArtifact,
  SerializedComposedGraphArtifact,
} from './composeGraphs.types.js';

function parseGRPCMapping(mappings: string): GRPCMapping {
  try {
    return GRPCMapping.fromJson(JSON.parse(mappings));
  } catch (error) {
    throw new Error(`Failed to parse gRPC mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Build rich RouterSubgraph objects from SubgraphDTOs and federation result.
 * Only needed when building router execution config.
 */
function subgraphDTOsToRouterSubgraphs(
  organizationId: string,
  subgraphs: SubgraphDTO[],
  result: FederationResult,
): RouterSubgraph[] {
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
      url: subgraph.routingUrl,
      sdl: subgraph.schemaSDL,
      subscriptionUrl: subgraph.subscriptionUrl,
      subscriptionProtocol: subgraph.subscriptionProtocol,
      websocketSubprotocol:
        subgraph.subscriptionProtocol === 'ws' ? subgraph.websocketSubprotocol || 'auto' : undefined,
      configurationDataByTypeName,
      schema,
    };
  });
}

// Serialize the worker-side composition result into a structured-clone-safe
// artifact for the main thread. This keeps the boundary limited to plain data,
// and the main thread is responsible for rebuilding richer runtime objects
// such as RouterConfig instances before persistence and upload.
function serializeComposedGraphArtifact(
  organizationId: string,
  routerCompatibilityVersion: string,
  subgraphs: SubgraphDTO[],
  result: FederationResult,
  includeRouterExecutionConfig: boolean,
): SerializedComposedGraphArtifact {
  const composedSchema = result.success ? printSchemaWithDirectives(result.federatedGraphSchema) : undefined;
  const federatedClientSchema = result.success
    ? printSchemaWithDirectives(result.federatedGraphClientSchema)
    : undefined;
  const shouldIncludeClientSchema = result.success ? (result.shouldIncludeClientSchema ?? false) : false;
  const fieldConfigurations = result.success ? result.fieldConfigurations : [];

  let routerExecutionConfigJson: ReturnType<RouterConfig['toJson']> | undefined;
  if (includeRouterExecutionConfig && result.success && composedSchema) {
    const routerSubgraphs = subgraphDTOsToRouterSubgraphs(organizationId, subgraphs, result);
    const routerExecutionConfig = buildRouterConfig({
      federatedClientSDL: shouldIncludeClientSchema ? federatedClientSchema || '' : '',
      federatedSDL: composedSchema,
      fieldConfigurations,
      routerCompatibilityVersion,
      subgraphs: routerSubgraphs,
      schemaVersionId: randomUUID(),
    });
    routerExecutionConfigJson = routerExecutionConfig.toJson();
  }

  return {
    success: result.success,
    errors: result.success ? [] : result.errors.map((error) => error.message),
    warnings: result.warnings.map((warning) => ({
      message: warning.message,
      subgraphName: warning.subgraph?.name,
    })),
    composedSchema,
    federatedClientSchema,
    shouldIncludeClientSchema,
    fieldConfigurations,
    subgraphs: subgraphs.map((subgraph) => ({
      id: subgraph.id,
      isFeatureSubgraph: subgraph.isFeatureSubgraph,
      name: subgraph.name,
      sdl: subgraph.schemaSDL,
      schemaVersionId: subgraph.schemaVersionId,
      targetId: subgraph.targetId,
    })),
    routerExecutionConfigJson,
  };
}

function toCompositionSubgraphs(subgraphs: SubgraphDTO[]) {
  return subgraphs
    .filter((s) => s.schemaSDL !== '')
    .map((subgraph) => ({
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

      // Version is validated on the main thread before dispatching to the worker.
      const version = task.routerCompatibilityVersion;

      const result: FederationResult | FederationResultWithContracts = task.federatedGraph.contract
        ? federateSubgraphsContract({
            contractTagOptions: newContractTagOptionsFromArrays(
              task.federatedGraph.contract.excludeTags,
              task.federatedGraph.contract.includeTags,
            ),
            options: task.compositionOptions,
            subgraphs: compositionSubgraphs,
            version,
          })
        : federateSubgraphsWithContracts({
            options: task.compositionOptions,
            subgraphs: compositionSubgraphs,
            tagOptionsByContractName,
            version,
          });

      const includeRouterConfig = !task.skipRouterConfig;
      const base = serializeComposedGraphArtifact(
        task.federatedGraph.organizationId,
        task.federatedGraph.routerCompatibilityVersion,
        subgraphsToCompose.subgraphs,
        result,
        includeRouterConfig,
      );

      const contracts: SerializedContractCompositionArtifact[] = [];
      if ('federationResultByContractName' in result && result.success) {
        for (const [contractName, contractResult] of result.federationResultByContractName as Map<
          string,
          FederationResult
        >) {
          contracts.push({
            contractName,
            artifact: serializeComposedGraphArtifact(
              task.federatedGraph.organizationId,
              task.federatedGraph.routerCompatibilityVersion,
              subgraphsToCompose.subgraphs,
              contractResult,
              includeRouterConfig,
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
