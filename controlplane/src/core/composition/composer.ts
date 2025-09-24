import type { UUID } from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  ContractTagOptions,
  FederationResult,
  FieldConfiguration,
  newContractTagOptionsFromArrays,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  ROUTER_COMPATIBILITY_VERSIONS,
  Subgraph,
  SupportedRouterCompatibilityVersion,
  Warning,
} from '@wundergraph/composition';
import {
  buildRouterConfig,
  ComposedSubgraph as IComposedSubgraph,
  ComposedSubgraphGRPC,
  ComposedSubgraphPlugin,
  SubgraphKind,
} from '@wundergraph/cosmo-shared';
import { FastifyBaseLogger } from 'fastify';
import { DocumentNode, GraphQLSchema, parse } from 'graphql';
import {
  FeatureFlagRouterExecutionConfig,
  FeatureFlagRouterExecutionConfigs,
  GRPCMapping,
  ImageReference,
  RouterConfig,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CompositionOptions, FederatedGraphDTO, Label, SubgraphDTO } from '../../types/index.js';
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
import { composeFederatedGraphWithPotentialContracts, composeSubgraphs } from './composition.js';
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
  compositions: ComposedFederatedGraph[];
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

export function buildRouterExecutionConfig(
  composedGraph: ComposedFederatedGraph,
  federatedSchemaVersionId: UUID,
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

export type ComposedSubgraph = (IComposedSubgraph | ComposedSubgraphPlugin | ComposedSubgraphGRPC) & {
  targetId: string;
  isFeatureSubgraph: boolean;
  schemaVersionId: string;
};

const parseGRPCMapping = (mappings: string): GRPCMapping => {
  try {
    const mappingsJson = JSON.parse(mappings);
    return GRPCMapping.fromJson(mappingsJson);
  } catch (error) {
    throw new Error(`Failed to parse gRPC mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export function subgraphDTOsToComposedSubgraphs(
  organizationId: string,
  subgraphs: SubgraphDTO[],
  result: FederationResult,
): ComposedSubgraph[] {
  return subgraphs.map((subgraph) => {
    /* batchNormalize returns an intermediate representation of the engine configuration
     *  and a normalized schema per subgraph.
     *  Batch normalization is necessary because validation of certain things such as the @override directive requires
     *  knowledge of the other subgraphs.
     *  Each normalized schema and engine configuration is mapped by subgraph name to a SubgraphConfig object wrapper.
     *  This is passed to the FederationFactory and is returned by federateSubgraphs if federation is successful.
     *  The normalized schema and engine configuration is used by buildRouterConfig.
     * */
    const subgraphConfig = result.success ? result.subgraphConfigBySubgraphName.get(subgraph.name) : undefined;
    const schema = subgraphConfig?.schema;
    const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;

    if (subgraph.type === 'grpc_plugin') {
      if (!subgraph.proto || !subgraph.proto.pluginData) {
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

export function mapResultToComposedGraph(
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

export interface ComposedFederatedGraph {
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
export class Composer {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private federatedGraphRepo: FederatedGraphRepository,
    private subgraphRepo: SubgraphRepository,
    private contractRepo: ContractRepository,
    private graphCompositionRepository: GraphCompositionRepository,
    private chClient?: ClickHouseClient,
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
  }): Promise<{
    errors: ComposeDeploymentError[];
  }> {
    const routerConfigJsonStringBytes = Buffer.from(routerConfig.toJsonString(), 'utf8');
    const errors: ComposeDeploymentError[] = [];

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
    const s3PathDraft = `${organizationId}/${federatedGraphId}/routerconfigs/draft.json`;
    const s3PathReady = `${organizationId}/${federatedGraphId}/routerconfigs/${versionPath}latest.json`;

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
    mapSubgraphs: (
      subgraphs: SubgraphDTO[],
    ) => [SubgraphDTO[], { name: string; url: string; definitions: DocumentNode }[]],
    compositionOptions?: CompositionOptions,
  ): Promise<CompositionResult> {
    const composedGraphs: ComposedFederatedGraph[] = [];

    const graphs = await this.federatedGraphRepo.bySubgraphLabels({
      labels: subgraphLabels,
      namespaceId,
      excludeContracts: true,
    });

    for await (const graph of graphs) {
      try {
        const [subgraphs, subgraphsToBeComposed] = mapSubgraphs(
          await this.subgraphRepo.listByFederatedGraph({ federatedGraphTargetId: graph.targetId }),
        );

        const contracts = await this.contractRepo.bySourceFederatedGraphId(graph.id);

        if (contracts.length === 0) {
          const federationResult = composeSubgraphs(
            subgraphsToBeComposed,
            graph.routerCompatibilityVersion,
            compositionOptions,
          );
          composedGraphs.push(mapResultToComposedGraph(graph, subgraphs, federationResult));
          continue;
        }

        const tagOptionsByContractName = new Map<string, ContractTagOptions>();

        for (const contract of contracts) {
          tagOptionsByContractName.set(
            contract.downstreamFederatedGraph.target.name,
            newContractTagOptionsFromArrays(contract.excludeTags, contract.includeTags),
          );
        }

        const federationResult = composeFederatedGraphWithPotentialContracts(
          subgraphsToBeComposed,
          tagOptionsByContractName,
          graph.routerCompatibilityVersion,
          compositionOptions,
        );
        composedGraphs.push(mapResultToComposedGraph(graph, subgraphs, federationResult));

        if (!federationResult.success) {
          continue;
        }

        for (const [contractName, contractResult] of federationResult.federationResultByContractName) {
          const contractGraph = await this.federatedGraphRepo.byName(contractName, graph.namespace);
          if (!contractGraph) {
            throw new Error(`Contract graph ${contractName} not found`);
          }
          composedGraphs.push(mapResultToComposedGraph(contractGraph, subgraphs, contractResult));
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
        const subgraphsToBeComposed: Array<Subgraph> = [];

        for (const subgraph of subgraphs) {
          if (subgraph.name === subgraphName) {
            subgraphsToBeComposed.push({
              name: subgraph.name,
              url: subgraph.routingUrl,
              definitions: parse(subgraphSchemaSDL),
            });
          } else if (subgraph.schemaSDL !== '') {
            subgraphsToBeComposed.push({
              name: subgraph.name,
              url: subgraph.routingUrl,
              definitions: parse(subgraph.schemaSDL),
            });
          }
        }

        return [subgraphs, subgraphsToBeComposed];
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
    const composedGraphs: ComposedFederatedGraph[] = [];
    // the key is the federated graph id and the value is the list of check subgraph ids which are part of the composition for that federated graph
    const checkSubgraphsByFedGraph = new Map<string, string[]>();
    for (const graph of graphs) {
      try {
        const subgraphsOfFedGraph = await this.subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
        });

        const subgraphsToBeComposed: Subgraph[] = [];
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
            subgraphsToBeComposed.push({
              name: subgraph.name,
              url: subgraph.routingUrl,
              definitions: parse(inputSubgraph.newSchemaSDL),
            });
          } else if (subgraph.schemaSDL !== '') {
            subgraphsToBeComposed.push({
              name: subgraph.name,
              url: subgraph.routingUrl,
              definitions: parse(subgraph.schemaSDL),
            });
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
          subgraphsToBeComposed.push({
            name: subgraphName,
            url: '',
            definitions: parse(subgraph.newSchemaSDL),
          });
        }

        const contracts = await this.contractRepo.bySourceFederatedGraphId(graph.id);

        if (contracts.length === 0) {
          const federationResult = composeSubgraphs(
            subgraphsToBeComposed,
            graph.routerCompatibilityVersion,
            compositionOptions,
          );
          composedGraphs.push(mapResultToComposedGraph(graph, subgraphsOfFedGraph, federationResult));
          continue;
        }

        const tagOptionsByContractName = new Map<string, ContractTagOptions>();

        for (const contract of contracts) {
          tagOptionsByContractName.set(
            contract.downstreamFederatedGraph.target.name,
            newContractTagOptionsFromArrays(contract.excludeTags, contract.includeTags),
          );
        }

        const federationResult = composeFederatedGraphWithPotentialContracts(
          subgraphsToBeComposed,
          tagOptionsByContractName,
          graph.routerCompatibilityVersion,
          compositionOptions,
        );
        composedGraphs.push(mapResultToComposedGraph(graph, subgraphsOfFedGraph, federationResult));

        if (!federationResult.success) {
          continue;
        }

        for (const [contractName, contractResult] of federationResult.federationResultByContractName) {
          const contractGraph = await this.federatedGraphRepo.byName(contractName, graph.namespace);
          if (!contractGraph) {
            throw new Error(`Contract graph ${contractName} not found`);
          }
          composedGraphs.push(mapResultToComposedGraph(contractGraph, subgraphsOfFedGraph, contractResult));
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
