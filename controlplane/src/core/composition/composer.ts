import type { UUID } from 'node:crypto';
import {
  CompositionOptions,
  FieldConfiguration,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  ROUTER_COMPATIBILITY_VERSIONS,
  SupportedRouterCompatibilityVersion,
  Warning,
} from '@wundergraph/composition';
import { FastifyBaseLogger } from 'fastify';
import { GraphQLSchema } from 'graphql';
import {
  FeatureFlagRouterExecutionConfig,
  FeatureFlagRouterExecutionConfigs,
  RouterConfig,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FederatedGraphDTO, Label, SubgraphDTO } from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import { audiences, nowInSeconds, signJwtHS256 } from '../crypto/jwt.js';
import { ContractRepository } from '../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import {
  AdmissionError,
  AdmissionWebhookController,
  AdmissionWebhookJwtPayload,
} from '../services/AdmissionWebhookController.js';
import { GraphCompositionRepository } from '../repositories/GraphCompositionRepository.js';
import * as schema from '../../db/schema.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { CacheWarmerRepository } from '../repositories/CacheWarmerRepository.js';
import { NamespaceRepository } from '../repositories/NamespaceRepository.js';
import { InspectorSchemaChange } from '../services/SchemaUsageTrafficInspector.js';
import { SchemaCheckChangeAction } from '../../db/models.js';
import { traced } from '../tracing.js';
import {
  composeGraphsInWorker,
  DeserializedComposedGraph,
  deserializeComposedGraphArtifact,
} from './composeGraphs.pool.js';
import { getDiffBetweenGraphs, GetDiffBetweenGraphsResult, GetDiffBetweenGraphsSuccess } from './schemaCheck.js';

export function getRouterCompatibilityVersionPath(routerCompatibilityVersion: string): string {
  switch (routerCompatibilityVersion) {
    case ROUTER_COMPATIBILITY_VERSION_ONE: {
      return '';
    }
    default: {
      return `${routerCompatibilityVersion}/`;
    }
  }
}

export type CompositionResult = {
  compositions: DeserializedComposedGraph[];
};

export interface S3RouterConfigMetadata extends Record<string, string> {
  version: string;
  'signature-sha256': string;
}

export type BaseCompositionData = {
  featureFlagRouterExecutionConfigByFeatureFlagName: Map<string, FeatureFlagRouterExecutionConfig>;
  routerExecutionConfig?: RouterConfig;
  schemaVersionId?: string;
};

/* The contract base composition schema version ID, router execution config,
 * and its feature flag schema versions (if any)
 * */
export type ContractBaseCompositionData = {
  featureFlagRouterExecutionConfigByFeatureFlagName: Map<string, FeatureFlagRouterExecutionConfig>;
  routerExecutionConfig: RouterConfig;
  schemaVersionId: string;
};

export function routerConfigToFeatureFlagExecutionConfig(routerConfig: RouterConfig): FeatureFlagRouterExecutionConfig {
  return new FeatureFlagRouterExecutionConfig({
    engineConfig: routerConfig.engineConfig,
    subgraphs: routerConfig.subgraphs,
    version: routerConfig.version,
  });
}

/**
 * The minimal subgraph fields required for composition persistence (changelog, composition records).
 * The full ComposedSubgraph carries additional runtime data (url, sdl, schema, gRPC metadata, etc.)
 * that is only needed for building router execution configs.
 */
export interface CompositionSubgraphRecord {
  id: string;
  name: string;
  sdl: string;
  targetId: string;
  schemaVersionId: string;
  isFeatureSubgraph: boolean;
}

export interface ComposedFederatedGraph {
  id: string;
  targetID: string;
  name: string;
  namespace: string;
  namespaceId: string;
  composedSchema?: string;
  errors: Error[];
  subgraphs: CompositionSubgraphRecord[];
  fieldConfigurations: FieldConfiguration[];
  federatedClientSchema?: string;
  shouldIncludeClientSchema?: boolean;
  warnings: Warning[];
}

export interface CompositionDeployResult {
  schemaVersionId: string;
}

export class RouterConfigUploadError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    Object.setPrototypeOf(this, RouterConfigUploadError.prototype);
  }
}

export type ComposeDeploymentError = RouterConfigUploadError | AdmissionError | Error;

export type CheckSubgraph = {
  subgraph?: SubgraphDTO;
  checkSubgraphId: string;
  newSchemaSDL: string;
  newGraphQLSchema?: GraphQLSchema;
  inspectorChanges: InspectorSchemaChange[];
  schemaChanges: GetDiffBetweenGraphsSuccess;
  storedBreakingChanges: SchemaCheckChangeAction[];
  routerCompatibilityVersion: string;
  // will be used only for new subgraphs
  labels?: Label[];
};

@traced
export class Composer {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private federatedGraphRepo: FederatedGraphRepository,
    private subgraphRepo: SubgraphRepository,
    private contractRepo: ContractRepository,
    private graphCompositionRepository: GraphCompositionRepository,
    private chClient?: ClickHouseClient,
    private proxyUrl?: string,
  ) {}

  composeRouterConfigWithFeatureFlags({
    featureFlagRouterExecutionConfigByFeatureFlagName,
    baseCompositionRouterExecutionConfig,
  }: {
    featureFlagRouterExecutionConfigByFeatureFlagName: Map<string, FeatureFlagRouterExecutionConfig>;
    // The base composition is the base federated graph on which feature flags and contracts are based
    baseCompositionRouterExecutionConfig: RouterConfig;
  }) {
    if (featureFlagRouterExecutionConfigByFeatureFlagName.size === 0) {
      return new RouterConfig({
        ...baseCompositionRouterExecutionConfig,
      });
    }
    const featureFlagRouterConfigs: { [key: string]: FeatureFlagRouterExecutionConfig } = {};
    for (const [featureFlagName, routerExecutionConfig] of featureFlagRouterExecutionConfigByFeatureFlagName) {
      featureFlagRouterConfigs[featureFlagName] = routerExecutionConfig;
    }
    const featureFlagConfigs = baseCompositionRouterExecutionConfig.featureFlagConfigs;
    if (featureFlagConfigs) {
      const configByFeatureFlagName = featureFlagConfigs.configByFeatureFlagName;
      for (const featureFlagName in featureFlagRouterConfigs) {
        configByFeatureFlagName[featureFlagName] = featureFlagRouterConfigs[featureFlagName];
      }
    } else {
      baseCompositionRouterExecutionConfig.featureFlagConfigs = new FeatureFlagRouterExecutionConfigs({
        configByFeatureFlagName: featureFlagRouterConfigs,
      });
    }

    return new RouterConfig({
      ...baseCompositionRouterExecutionConfig,
    });
  }

  async uploadRouterConfig({
    routerConfig,
    blobStorage,
    organizationId,
    federatedGraphId,
    federatedSchemaVersionId,
    admissionConfig,
    admissionWebhookURL,
    admissionWebhookSecret,
    actorId,
    routerCompatibilityVersion,
    pathOverride,
  }: {
    routerConfig: RouterConfig;
    blobStorage: BlobStorage;
    organizationId: string;
    federatedGraphId: string;
    federatedSchemaVersionId: string;
    admissionConfig: {
      jwtSecret: string;
      cdnBaseUrl: string;
    };
    admissionWebhookURL?: string;
    admissionWebhookSecret?: string;
    actorId: string;
    routerCompatibilityVersion: string;
    pathOverride?: { ready: string; draft: string };
  }): Promise<{
    errors: ComposeDeploymentError[];
  }> {
    const routerConfigJsonStringBytes = Buffer.from(routerConfig.toJsonString(), 'utf8');
    const errors: ComposeDeploymentError[] = [];

    let s3PathDraft: string;
    let s3PathReady: string;

    if (pathOverride?.ready && pathOverride?.draft) {
      s3PathDraft = pathOverride.draft;
      s3PathReady = pathOverride.ready;
    } else {
      let versionPath = '';
      if (routerCompatibilityVersion !== ROUTER_COMPATIBILITY_VERSION_ONE) {
        if (ROUTER_COMPATIBILITY_VERSIONS.has(routerCompatibilityVersion as SupportedRouterCompatibilityVersion)) {
          versionPath = `${routerCompatibilityVersion}/`;
        } else {
          errors.push(
            new RouterConfigUploadError(`Invalid router compatibility version "${routerCompatibilityVersion}".`),
          );
          return {
            errors,
          };
        }
      }

      // CDN path and bucket path are the same in this case
      s3PathDraft = `${organizationId}/${federatedGraphId}/routerconfigs/draft.json`;
      s3PathReady = `${organizationId}/${federatedGraphId}/routerconfigs/${versionPath}latest.json`;
    }

    // The signature will be added by the admission webhook
    let signatureSha256: undefined | string;

    // It is important to use undefined here, we do not null check in the database queries
    let deploymentError: RouterConfigUploadError | undefined;
    let admissionError: AdmissionError | undefined;

    if (admissionWebhookURL) {
      try {
        // 1. Upload the draft config to the blob storage
        // so that the admission webhook can download it.
        await blobStorage.putObject<S3RouterConfigMetadata>({
          key: s3PathDraft,
          body: routerConfigJsonStringBytes,
          contentType: 'application/json; charset=utf-8',
          metadata: {
            version: federatedSchemaVersionId,
            'signature-sha256': '', // The signature will be added by the admission webhook
          },
        });
        try {
          // 2. Create a private URL with a token that the admission webhook can use to fetch the draft config.
          // The token is valid for 5 minutes and signed with the organization ID and the federated graph ID.
          const token = await signJwtHS256<AdmissionWebhookJwtPayload>({
            secret: admissionConfig.jwtSecret,
            token: {
              exp: nowInSeconds() + 5 * 60, // 5 minutes
              aud: audiences.cosmoCDNAdmission, // to distinguish from other tokens
              organization_id: organizationId,
              federated_graph_id: federatedGraphId,
            },
          });
          const admissionWebhookController = new AdmissionWebhookController(
            this.db,
            this.logger,
            admissionWebhookURL,
            admissionWebhookSecret,
            this.proxyUrl,
          );
          const resp = await admissionWebhookController.validateConfig(
            {
              privateConfigUrl: `${admissionConfig.cdnBaseUrl}/${s3PathDraft}?token=${token}`,
              organizationId,
              federatedGraphId,
            },
            actorId,
          );
          signatureSha256 = resp.signatureSha256;
        } finally {
          // Always clean up the draft config after the draft has been validated.
          await blobStorage.deleteObject({
            key: s3PathDraft,
          });
        }
      } catch (err: any) {
        this.logger.debug(
          {
            error: err,
            federatedGraphId,
          },
          `Admission webhook failed to validate the router config for the federated graph.`,
        );
        if (err instanceof AdmissionError) {
          admissionError = err;
        } else {
          admissionError = new AdmissionError('Admission webhook failed to validate the router config', err);
        }
      }
    }

    // Deploy the final router config to the blob storage if the admission webhook did not fail
    if (!admissionError) {
      try {
        await blobStorage.putObject<S3RouterConfigMetadata>({
          key: s3PathReady,
          body: routerConfigJsonStringBytes,
          contentType: 'application/json; charset=utf-8',
          metadata: {
            version: federatedSchemaVersionId,
            'signature-sha256': signatureSha256 || '',
          },
        });
      } catch (err: any) {
        this.logger.error(err, `Failed to upload the final router config for ${federatedGraphId} to the blob storage`);
        deploymentError = new RouterConfigUploadError('Failed to upload the final router config to the CDN', err);
      }
    }

    if (deploymentError || admissionError) {
      await this.graphCompositionRepository.updateComposition({
        fedGraphSchemaVersionId: federatedSchemaVersionId,
        deploymentErrorString: deploymentError?.message,
        admissionErrorString: admissionError?.message,
      });
    } else if (signatureSha256) {
      await this.graphCompositionRepository.updateComposition({
        fedGraphSchemaVersionId: federatedSchemaVersionId,
        routerConfigSignature: signatureSha256,
      });
    }

    if (deploymentError) {
      errors.push(deploymentError);
    }

    if (admissionError) {
      errors.push(admissionError);
    }

    return {
      errors,
    };
  }

  async composeAndUploadRouterConfig({
    admissionConfig,
    baseCompositionRouterExecutionConfig,
    baseCompositionSchemaVersionId,
    blobStorage,
    featureFlagRouterExecutionConfigByFeatureFlagName,
    federatedGraphId,
    organizationId,
    federatedGraphAdmissionWebhookURL,
    federatedGraphAdmissionWebhookSecret,
    actorId,
    pathOverride,
  }: {
    admissionConfig: {
      jwtSecret: string;
      cdnBaseUrl: string;
    };
    baseCompositionRouterExecutionConfig: RouterConfig;
    baseCompositionSchemaVersionId: string;
    blobStorage: BlobStorage;
    featureFlagRouterExecutionConfigByFeatureFlagName: Map<string, FeatureFlagRouterExecutionConfig>;
    federatedGraphId: string;
    organizationId: string;
    federatedGraphAdmissionWebhookURL?: string;
    federatedGraphAdmissionWebhookSecret?: string;
    actorId: string;
    pathOverride?: { ready: string; draft: string };
  }) {
    const baseRouterConfig = this.composeRouterConfigWithFeatureFlags({
      featureFlagRouterExecutionConfigByFeatureFlagName,
      baseCompositionRouterExecutionConfig,
    });

    const federatedGraph = await this.federatedGraphRepo.byId(federatedGraphId);
    if (!federatedGraph) {
      throw new Error(`Federated graph not found.`);
    }
    const namespaceRepository = new NamespaceRepository(this.db, organizationId);
    const namespace = await namespaceRepository.byId(federatedGraph!.namespaceId);

    if (namespace?.enableCacheWarmer && this.chClient) {
      const cacheWarmerRepo = new CacheWarmerRepository(this.chClient, this.db);
      await cacheWarmerRepo.fetchAndUploadCacheWarmerOperations({
        blobStorage,
        federatedGraphId,
        organizationId,
        namespaceId: namespace.id,
        logger: this.logger,
      });
    }

    const { errors } = await this.uploadRouterConfig({
      blobStorage,
      federatedGraphId,
      federatedSchemaVersionId: baseCompositionSchemaVersionId,
      organizationId,
      routerConfig: baseRouterConfig,
      admissionWebhookURL: federatedGraphAdmissionWebhookURL,
      admissionWebhookSecret: federatedGraphAdmissionWebhookSecret,
      admissionConfig: {
        cdnBaseUrl: admissionConfig.cdnBaseUrl,
        jwtSecret: admissionConfig.jwtSecret,
      },
      actorId,
      routerCompatibilityVersion: federatedGraph.routerCompatibilityVersion,
      pathOverride,
    });

    return {
      errors,
    };
  }

  /**
   * Create a new schema version for the composition and stores a diff and changelog between the
   * previous and current schema as changelog.
   */
  async saveComposition({
    composedGraph,
    composedById,
    isFeatureFlagComposition,
    federatedSchemaVersionId,
    routerExecutionConfig,
    featureFlagId,
  }: {
    composedGraph: ComposedFederatedGraph;
    composedById: string;
    isFeatureFlagComposition: boolean;
    federatedSchemaVersionId: UUID;
    routerExecutionConfig?: RouterConfig;
    featureFlagId: string;
  }): Promise<CompositionDeployResult> {
    const prevValidFederatedSDL = await this.federatedGraphRepo.getLatestValidSchemaVersion({
      targetId: composedGraph.targetID,
    });

    const updatedFederatedGraph = await this.federatedGraphRepo.addSchemaVersion({
      targetId: composedGraph.targetID,
      composedSDL: composedGraph.composedSchema,
      clientSchema: composedGraph.federatedClientSchema,
      composedSubgraphs: composedGraph.subgraphs,
      compositionErrors: composedGraph.errors,
      compositionWarnings: composedGraph.warnings,
      composedById,
      schemaVersionId: federatedSchemaVersionId,
      isFeatureFlagComposition,
      featureFlagId,
    });

    // If the composed schema is invalid, or it is a feature flag composition, we do not create a changelog
    if (!routerExecutionConfig || !updatedFederatedGraph?.composedSchemaVersionId || isFeatureFlagComposition) {
      return {
        schemaVersionId: updatedFederatedGraph?.composedSchemaVersionId || '',
      };
    }

    let schemaChanges: GetDiffBetweenGraphsResult;

    // Prioritize diff against client schemas if no previous valid schema available or if both prev and current client schema is available.
    if (
      (composedGraph.federatedClientSchema && !prevValidFederatedSDL) ||
      (composedGraph.federatedClientSchema && prevValidFederatedSDL?.clientSchema)
    ) {
      schemaChanges = await getDiffBetweenGraphs(
        prevValidFederatedSDL?.clientSchema || '',
        composedGraph.federatedClientSchema,
        updatedFederatedGraph.routerCompatibilityVersion,
      );
    } else {
      // Fallback to full schema for backwards compatibility
      schemaChanges = await getDiffBetweenGraphs(
        prevValidFederatedSDL?.schema || '',
        composedGraph.composedSchema || '',
        updatedFederatedGraph.routerCompatibilityVersion,
      );
    }

    if (schemaChanges.kind !== 'failure' && schemaChanges.changes.length > 0) {
      await this.federatedGraphRepo.createFederatedGraphChangelog({
        schemaVersionID: updatedFederatedGraph.composedSchemaVersionId,
        changes: schemaChanges.changes,
      });
    }

    return {
      schemaVersionId: updatedFederatedGraph?.composedSchemaVersionId || '',
    };
  }

  protected async composeWithLabels(
    subgraphLabels: Label[],
    namespaceId: string,
    mapSubgraphs: (subgraphs: SubgraphDTO[]) => SubgraphDTO[],
    compositionOptions?: CompositionOptions,
  ): Promise<CompositionResult> {
    const composedGraphs: DeserializedComposedGraph[] = [];

    const graphs = await this.federatedGraphRepo.bySubgraphLabels({
      labels: subgraphLabels,
      namespaceId,
      excludeContracts: true,
    });

    for await (const graph of graphs) {
      try {
        const allSubgraphs = await this.subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
        });
        const subgraphsToSend = mapSubgraphs(allSubgraphs);

        const contracts = await this.contractRepo.bySourceFederatedGraphId(graph.id);
        const tagOptionsByContractName = contracts.map((c) => ({
          contractName: c.downstreamFederatedGraph.target.name,
          excludeTags: c.excludeTags,
          includeTags: c.includeTags,
        }));

        const { results } = await composeGraphsInWorker({
          federatedGraph: graph,
          subgraphsToCompose: [
            {
              subgraphs: subgraphsToSend,
              isFeatureFlagComposition: false,
              featureFlagName: '',
              featureFlagId: '',
            },
          ],
          tagOptionsByContractName,
          compositionOptions,
          skipRouterConfig: true,
        });

        const base = results[0];
        composedGraphs.push(deserializeComposedGraphArtifact(graph, base.base));

        for (const contractArtifact of base.contracts) {
          const contractGraph = await this.federatedGraphRepo.byName(contractArtifact.contractName, graph.namespace);
          if (!contractGraph) {
            throw new Error(`Contract graph ${contractArtifact.contractName} not found`);
          }
          composedGraphs.push(deserializeComposedGraphArtifact(contractGraph, contractArtifact.artifact));
        }
      } catch (e: any) {
        composedGraphs.push({
          id: graph.id,
          name: graph.name,
          namespace: graph.namespace,
          namespaceId: graph.namespaceId,
          targetID: graph.targetId,
          fieldConfigurations: [],
          errors: [e],
          subgraphs: [],
          warnings: [],
        });
      }
    }

    return {
      compositions: composedGraphs,
    };
  }

  /**
   * Same as compose, but the proposed schemaSDL of the subgraph is not updated to the table, so it is passed to the function
   */
  composeWithProposedSDL(
    subgraphLabels: Label[],
    subgraphName: string,
    namespaceId: string,
    subgraphSchemaSDL: string,
    compositionOptions?: CompositionOptions,
  ) {
    return this.composeWithLabels(
      subgraphLabels,
      namespaceId,
      (subgraphs) => {
        return subgraphs
          .filter((s) => s.name === subgraphName || s.schemaSDL !== '')
          .map((s) => (s.name === subgraphName ? { ...s, schemaSDL: subgraphSchemaSDL } : s));
      },
      compositionOptions,
    );
  }

  async composeWithProposedSchemas({
    compositionOptions,
    graphs,
    inputSubgraphs,
  }: {
    graphs: FederatedGraphDTO[];
    inputSubgraphs: Map<string, CheckSubgraph>;
    compositionOptions?: CompositionOptions;
  }) {
    const composedGraphs: DeserializedComposedGraph[] = [];
    // the key is the federated graph id and the value is the list of check subgraph ids which are part of the composition for that federated graph
    const checkSubgraphsByFedGraph = new Map<string, string[]>();
    for (const graph of graphs) {
      try {
        const subgraphsOfFedGraph = await this.subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
        });

        const subgraphsToSend: SubgraphDTO[] = [];
        for (const subgraph of subgraphsOfFedGraph) {
          const inputSubgraph = inputSubgraphs.get(subgraph.name);
          if (inputSubgraph) {
            checkSubgraphsByFedGraph.set(graph.id, [
              ...(checkSubgraphsByFedGraph.get(graph.id) || []),
              inputSubgraph.checkSubgraphId,
            ]);
            if (inputSubgraph.newSchemaSDL === '') {
              continue;
            }
            subgraphsToSend.push({ ...subgraph, schemaSDL: inputSubgraph.newSchemaSDL });
          } else if (subgraph.schemaSDL !== '') {
            subgraphsToSend.push(subgraph);
          }
        }

        // Handles new subgraphs
        for (const [subgraphName, subgraph] of inputSubgraphs.entries()) {
          if (subgraph.subgraph || subgraph.newSchemaSDL === '') {
            continue;
          }
          // get the fed graphs which match the labels of the new subgraph
          const fedGraphsOfNewSubgraphs = await this.federatedGraphRepo.bySubgraphLabels({
            labels: subgraph.labels || [],
            namespaceId: graph.namespaceId,
            excludeContracts: true,
          });

          // if the current fed graph(the main loop) is present in the list of fed graphs which match the labels of the new subgraph, then we can compose the new subgraph
          if (!fedGraphsOfNewSubgraphs.some((fg) => fg.id === graph.id)) {
            continue;
          }

          checkSubgraphsByFedGraph.set(graph.id, [
            ...(checkSubgraphsByFedGraph.get(graph.id) || []),
            subgraph.checkSubgraphId,
          ]);
          subgraphsToSend.push({
            id: '',
            name: subgraphName,
            targetId: '',
            routingUrl: '',
            schemaSDL: subgraph.newSchemaSDL,
            schemaVersionId: '',
            isFeatureSubgraph: false,
            subscriptionUrl: '',
            subscriptionProtocol: 'ws',
            namespace: graph.namespace,
            namespaceId: graph.namespaceId,
            type: 'standard',
            labels: subgraph.labels || [],
            lastUpdatedAt: '',
            isEventDrivenGraph: false,
          } as SubgraphDTO);
        }

        const contracts = await this.contractRepo.bySourceFederatedGraphId(graph.id);
        const tagOptionsByContractName = contracts.map((c) => ({
          contractName: c.downstreamFederatedGraph.target.name,
          excludeTags: c.excludeTags,
          includeTags: c.includeTags,
        }));

        const { results } = await composeGraphsInWorker({
          federatedGraph: graph,
          subgraphsToCompose: [
            {
              subgraphs: subgraphsToSend,
              isFeatureFlagComposition: false,
              featureFlagName: '',
              featureFlagId: '',
            },
          ],
          tagOptionsByContractName,
          compositionOptions,
          skipRouterConfig: true,
        });

        const base = results[0];
        composedGraphs.push(deserializeComposedGraphArtifact(graph, base.base));

        for (const contractArtifact of base.contracts) {
          const contractGraph = await this.federatedGraphRepo.byName(contractArtifact.contractName, graph.namespace);
          if (!contractGraph) {
            throw new Error(`Contract graph ${contractArtifact.contractName} not found`);
          }
          composedGraphs.push(deserializeComposedGraphArtifact(contractGraph, contractArtifact.artifact));
        }
      } catch (e: any) {
        composedGraphs.push({
          id: graph.id,
          name: graph.name,
          namespace: graph.namespace,
          namespaceId: graph.namespaceId,
          targetID: graph.targetId,
          fieldConfigurations: [],
          errors: [e],
          subgraphs: [],
          warnings: [],
        });
      }
    }
    return {
      composedGraphs,
      checkSubgraphsByFedGraph,
    };
  }
}
