import type { UUID } from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  FederationResult,
  FederationResultContainerWithContracts,
  FieldConfiguration,
  Subgraph,
} from '@wundergraph/composition';
import { buildRouterConfig, ComposedSubgraph } from '@wundergraph/cosmo-shared';
import { FastifyBaseLogger } from 'fastify';
import { DocumentNode, parse, printSchema } from 'graphql';
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
import { composeSubgraphs, composeSubgraphsWithContracts } from './composition.js';
import { getDiffBetweenGraphs, GetDiffBetweenGraphsResult } from './schemaCheck.js';

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
): RouterConfig | undefined {
  if (composedGraph.errors.length > 0 || !composedGraph.composedSchema) {
    return;
  }
  const federatedClientSDL = composedGraph.shouldIncludeClientSchema ? composedGraph.federatedClientSchema || '' : '';
  return buildRouterConfig({
    federatedClientSDL,
    federatedSDL: composedGraph.composedSchema,
    fieldConfigurations: composedGraph.fieldConfigurations,
    subgraphs: composedGraph.subgraphs,
    schemaVersionId: federatedSchemaVersionId,
  });
}

export function subgraphDTOsToComposedSubgraphs(
  subgraphs: SubgraphDTO[],
  result?: FederationResult,
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
    const subgraphConfig = result?.subgraphConfigBySubgraphName.get(subgraph.name);
    const schema = subgraphConfig?.schema;
    const configurationDataMap = subgraphConfig?.configurationDataMap;
    return {
      id: subgraph.id,
      name: subgraph.name,
      url: subgraph.routingUrl,
      sdl: subgraph.schemaSDL,
      schemaVersionId: subgraph.schemaVersionId,
      subscriptionUrl: subgraph.subscriptionUrl,
      subscriptionProtocol: subgraph.subscriptionProtocol,
      websocketSubprotocol:
        subgraph.subscriptionProtocol === 'ws' ? subgraph.websocketSubprotocol || 'auto' : undefined,
      configurationDataMap,
      schema,
    };
  });
}

export function mapResultToComposedGraph(
  federatedGraph: FederatedGraphDTO,
  subgraphs: SubgraphDTO[],
  errors?: Error[],
  result?: FederationResult,
): ComposedFederatedGraph {
  return {
    id: federatedGraph.id,
    targetID: federatedGraph.targetId,
    name: federatedGraph.name,
    namespace: federatedGraph.namespace,
    namespaceId: federatedGraph.namespaceId,
    composedSchema: result?.federatedGraphSchema ? printSchemaWithDirectives(result.federatedGraphSchema) : undefined,
    federatedClientSchema: result?.federatedGraphClientSchema
      ? printSchema(result.federatedGraphClientSchema)
      : undefined,
    shouldIncludeClientSchema: result?.shouldIncludeClientSchema || false,
    errors: errors || [],
    subgraphs: subgraphDTOsToComposedSubgraphs(subgraphs, result),
    fieldConfigurations: result?.fieldConfigurations || [],
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

export class Composer {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private federatedGraphRepo: FederatedGraphRepository,
    private subgraphRepo: SubgraphRepository,
    private contractRepo: ContractRepository,
    private graphCompositionRepository: GraphCompositionRepository,
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
  }): Promise<{
    errors: ComposeDeploymentError[];
  }> {
    const routerConfigJsonStringBytes = Buffer.from(routerConfig.toJsonString(), 'utf8');

    // CDN path and bucket path are the same in this case
    const s3PathDraft = `${organizationId}/${federatedGraphId}/routerconfigs/draft.json`;
    const s3PathReady = `${organizationId}/${federatedGraphId}/routerconfigs/latest.json`;

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
        this.logger.debug(
          {
            error: err,
            federatedGraphId,
          },
          'Failed to upload the final router config to the blob storage',
        );
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

    const errors: ComposeDeploymentError[] = [];

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
      subgraphSchemaVersionIds: composedGraph.subgraphs.map((s) => s.schemaVersionId!),
      compositionErrors: composedGraph.errors,
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
      );
    } else {
      // Fallback to full schema for backwards compatibility
      schemaChanges = await getDiffBetweenGraphs(prevValidFederatedSDL?.schema || '', composedGraph.composedSchema);
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
  ): Promise<CompositionResult> {
    const composedGraphs: ComposedFederatedGraph[] = [];
    let federationResultContainer: FederationResultContainerWithContracts;

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

        if (contracts.length > 0) {
          const tagExclusionsByContractName: Map<string, Set<string>> = new Map();

          for (const contract of contracts) {
            tagExclusionsByContractName.set(
              contract.downstreamFederatedGraph.target.name,
              new Set(contract.excludeTags),
            );
          }

          federationResultContainer = composeSubgraphsWithContracts(subgraphsToBeComposed, tagExclusionsByContractName);
        } else {
          federationResultContainer = composeSubgraphs(subgraphsToBeComposed);
        }

        if (!federationResultContainer) {
          throw new Error('Could not federate subgraphs');
        }

        const { federationResult: result, errors, federationResultContainerByContractName } = federationResultContainer;

        composedGraphs.push(mapResultToComposedGraph(graph, subgraphs, errors, result));

        if (federationResultContainerByContractName) {
          for (const [contractName, contractResultContainer] of federationResultContainerByContractName.entries()) {
            const { errors: contractErrors, federationResult: contractResult } = contractResultContainer;

            const contractGraph = await this.federatedGraphRepo.byName(contractName, graph.namespace);
            if (!contractGraph) {
              throw new Error(`Contract graph ${contractName} not found`);
            }

            composedGraphs.push(mapResultToComposedGraph(contractGraph, subgraphs, contractErrors, contractResult));
          }
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
  ) {
    return this.composeWithLabels(subgraphLabels, namespaceId, (subgraphs) => {
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
    });
  }

  composeWithDeletedSubgraph(subgraphLabels: Label[], subgraphName: string, namespaceId: string) {
    return this.composeWithLabels(subgraphLabels, namespaceId, (subgraphs) => {
      const subgraphsToBeComposed: Array<Subgraph> = [];

      const filteredSubgraphs = subgraphs.filter((s) => s.name !== subgraphName);

      for (const subgraph of subgraphs) {
        if (subgraph.name !== subgraphName && subgraph.schemaSDL !== '') {
          subgraphsToBeComposed.push({
            name: subgraph.name,
            url: subgraph.routingUrl,
            definitions: parse(subgraph.schemaSDL),
          });
        }
      }

      return [filteredSubgraphs, subgraphsToBeComposed];
    });
  }
}
