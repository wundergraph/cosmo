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
import * as Sentry from '@sentry/node';
import { workerId } from 'tinypool';
import { z } from 'zod';
import { eventLoopBlockIntegration } from '@sentry/node-native';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import type { SubgraphDTO } from '../../types/index.js';
import type {
  ComposeGraphsTaskInput,
  ComposeGraphsTaskResult,
  SerializedContractCompositionArtifact,
  SerializedComposedGraphArtifact,
} from './composeGraphs.types.js';

/**
 * Because of the isolation, we need to handle the Sentry configuration/initialization here as we can't import it from
 * source (see header comment)
 */
const sentryEnvVariables = z.object({
  SENTRY_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .default('false'),
  SENTRY_DSN: z.string().optional(),
  SENTRY_SEND_DEFAULT_PII: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .default('false'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional().default(1),
  SENTRY_PROFILE_SESSION_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional().default(1),
  SENTRY_PROFILE_LIFECYCLE: z.enum(['manual', 'trace']).optional().default('manual'),
  SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS: z.coerce.number().int().min(0).optional().default(100),
  SENTRY_ENABLE_LOGS: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .default('false'),
});

const {
  SENTRY_ENABLED,
  SENTRY_DSN,
  SENTRY_SEND_DEFAULT_PII,
  SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  SENTRY_PROFILE_LIFECYCLE,
  SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS,
  SENTRY_ENABLE_LOGS,
} = sentryEnvVariables.parse(process.env);

if (SENTRY_ENABLED && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      eventLoopBlockIntegration({ threshold: SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS }),
      nodeProfilingIntegration(),
    ],
    profileSessionSampleRate: SENTRY_PROFILE_SESSION_SAMPLE_RATE,
    sendDefaultPii: SENTRY_SEND_DEFAULT_PII,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    profileLifecycle: SENTRY_PROFILE_LIFECYCLE,
    enableLogs: SENTRY_ENABLE_LOGS,
    spotlight: process.env.NODE_ENV !== 'production',
  });
}

function parseGRPCMapping(mappings: string): GRPCMapping {
  return Sentry.startSpan({ name: 'ComposeGraphsWorker.parseGRPCMapping' }, () => {
    try {
      return GRPCMapping.fromJson(JSON.parse(mappings));
    } catch (error) {
      throw new Error(`Failed to parse gRPC mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
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
  return Sentry.startSpan({ name: 'ComposeGraphsWorker.subgraphDTOsToRouterSubgraphs' }, () =>
    subgraphs.map((subgraph) => {
      const subgraphConfig = result.success ? result.subgraphConfigBySubgraphName.get(subgraph.name) : undefined;
      const schema = subgraphConfig?.schema;
      const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;
      const costs = subgraphConfig?.costs;

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
          costs,
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
          costs,
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
        costs,
      };
    }),
  );
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
  return Sentry.startSpan({ name: 'ComposeGraphsWorker.serializeComposedGraphArtifact' }, () => {
    const composedSchema = result.success
      ? Sentry.startSpan({ name: 'ComposeGraphsWorker.printSchemaWithDirectives' }, () =>
          printSchemaWithDirectives(result.federatedGraphSchema),
        )
      : undefined;

    const federatedClientSchema = result.success
      ? Sentry.startSpan({ name: 'ComposeGraphsWorker.printSchemaWithDirectives' }, () =>
          printSchemaWithDirectives(result.federatedGraphClientSchema),
        )
      : undefined;

    const shouldIncludeClientSchema = result.success ? (result.shouldIncludeClientSchema ?? false) : false;
    const fieldConfigurations = result.success ? result.fieldConfigurations : [];

    let routerExecutionConfigJson: ReturnType<RouterConfig['toJson']> | undefined;
    if (includeRouterExecutionConfig && result.success && composedSchema) {
      const routerSubgraphs = subgraphDTOsToRouterSubgraphs(organizationId, subgraphs, result);
      const routerExecutionConfig = Sentry.startSpan({ name: 'ComposeGraphsWorker.buildRouterConfig' }, () =>
        buildRouterConfig({
          federatedClientSDL: shouldIncludeClientSchema ? federatedClientSchema || '' : '',
          federatedSDL: composedSchema,
          fieldConfigurations,
          routerCompatibilityVersion,
          subgraphs: routerSubgraphs,
          schemaVersionId: randomUUID(),
        }),
      );
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
  });
}

function toCompositionSubgraphs(subgraphs: SubgraphDTO[]) {
  return Sentry.startSpan({ name: 'ComposeGraphsWorker.toCompositionSubgraphs' }, () =>
    subgraphs
      .filter((s) => s.schemaSDL !== '')
      .map((subgraph) => ({
        name: subgraph.name,
        url: subgraph.routingUrl,
        definitions: parse(subgraph.schemaSDL),
      })),
  );
}

export default function composeGraphsInWorker(task: ComposeGraphsTaskInput): ComposeGraphsTaskResult {
  return Sentry.continueTrace({ sentryTrace: task.trace?.sentryTrace, baggage: task.trace?.baggage }, () =>
    Sentry.startSpan(
      {
        name: 'ComposeGraphsWorker.composeGraphsInWorker',
        attributes: {
          workerId,
          federatedGraphId: task.federatedGraph.id,
          federatedGraphName: task.federatedGraph.name,
          subgraphsCount: task.federatedGraph.subgraphsCount,
          organizationId: task.federatedGraph.organizationId,
          namespaceId: task.federatedGraph.namespaceId,
        },
      },
      () => {
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
              ? Sentry.startSpan({ name: 'ComposeGraphsWorker.federateSubgraphsContract' }, () =>
                  federateSubgraphsContract({
                    contractTagOptions: newContractTagOptionsFromArrays(
                      task.federatedGraph.contract!.excludeTags,
                      task.federatedGraph.contract!.includeTags,
                    ),
                    options: task.compositionOptions,
                    subgraphs: compositionSubgraphs,
                    version,
                  }),
                )
              : Sentry.startSpan({ name: 'ComposeGraphsWorker.federateSubgraphsWithContracts' }, () =>
                  federateSubgraphsWithContracts({
                    options: task.compositionOptions,
                    subgraphs: compositionSubgraphs,
                    tagOptionsByContractName,
                    version,
                  }),
                );

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
      },
    ),
  );
}
