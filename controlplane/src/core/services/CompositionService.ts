/* eslint-disable no-labels */
import { createHash, randomUUID } from 'node:crypto';
import { JsonObject, PlainMessage } from '@bufbuild/protobuf';
import { FeatureFlagRouterExecutionConfig, RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { DeploymentError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { parse } from 'graphql';
import {
  CompositionOptions,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  ROUTER_COMPATIBILITY_VERSIONS,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';
import * as schema from '../../db/schema.js';
import {
  ComposeAndDeployResult,
  COMPOSITION_IGNORE_EXTERNAL_KEYS_FEATURE_ID,
  FeatureFlagDTO,
  FederatedGraphAndCompositionResults,
  FederatedGraphDTO,
  OrganizationFeatures,
  SPLIT_CONFIG_LOADING_FEATURE_ID,
} from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import {
  BaseCompositionData,
  Composer,
  ContractBaseCompositionData,
  routerConfigToFeatureFlagExecutionConfig,
  RouterConfigUploadError,
} from '../composition/composer.js';
import {
  composeGraphsInWorker,
  deserializeComposedGraphArtifact,
  DeserializedComposedGraph,
  deserializeRouterExecutionConfig,
} from '../composition/composeGraphs.pool.js';
import { unsuccessfulBaseCompositionError } from '../errors/errors.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { traced } from '../tracing.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { ComposeGraphsTaskResultItem, SerializedContractTagOptions } from '../composition/composeGraphs.types.js';
import { AdmissionError } from './AdmissionWebhookController.js';
import { ContractRepository } from './../repositories/ContractRepository.js';
import { FeatureFlagRepository, SubgraphsToCompose } from './../repositories/FeatureFlagRepository.js';
import { GraphCompositionRepository } from './../repositories/GraphCompositionRepository.js';
import { SubgraphRepository } from './../repositories/SubgraphRepository.js';

@traced
export class CompositionService {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
    private logger: FastifyBaseLogger,
    private admissionConfig: {
      webhookJWTSecret: string;
      cdnBaseUrl: string;
    },
    private blobStorage: BlobStorage,
    private chClient: ClickHouseClient | undefined,
    private webhookProxyUrl: string | undefined,
    private disableResolvabilityValidation: boolean | undefined,
  ) {}

  public async composeAndDeployFederatedGraph({
    actorId,
    federatedGraph,
  }: {
    actorId: string;
    federatedGraph: FederatedGraphDTO;
  }): Promise<ComposeAndDeployResult> {
    const orgFeatures = await this.#getOrganizationFeatures();
    const compositionOptions: CompositionOptions = {
      disableResolvabilityValidation: this.disableResolvabilityValidation,
      ignoreExternalKeys: orgFeatures.ignoreExternalKeys,
    };

    if (!orgFeatures.splitConfigLoading) {
      return this.#legacyComposeAndDeploy({
        actorId,
        federatedGraphs: [federatedGraph],
        compositionOptions,
      });
    }

    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const result: ComposeAndDeployResult = {
      deploymentErrors: [],
      compositionErrors: [],
      compositionWarnings: [],
    };

    // Get published subgraphs for recomposition of the federated graph
    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
      published: true,
    });

    let tagOptionsByContractName: SerializedContractTagOptions[];
    if (federatedGraph.contract) {
      tagOptionsByContractName = [
        {
          contractName: federatedGraph.name,
          excludeTags: federatedGraph.contract.excludeTags,
          includeTags: federatedGraph.contract.includeTags,
        },
      ];
    } else {
      const contractRepo = new ContractRepository(this.logger, this.db, this.organizationId);
      const contracts = await contractRepo.bySourceFederatedGraphId(federatedGraph.id);
      tagOptionsByContractName = contracts.map((contract) => ({
        contractName: contract.downstreamFederatedGraph.target.name,
        excludeTags: contract.excludeTags,
        includeTags: contract.includeTags,
      }));
    }

    const { results } = await composeGraphsInWorker({
      federatedGraph,
      subgraphsToCompose: [
        {
          subgraphs,
          isFeatureFlagComposition: false,
          featureFlagName: '',
          featureFlagId: '',
        },
      ],
      tagOptionsByContractName,
      compositionOptions,
    });

    await this.#handleCompositionResultsAndDeploy({
      actorId,
      graphAndCompositionResults: [{ federatedGraph, results }],
      result,
      splitConfig: true,
    });

    return result;
  }

  public async composeAndDeployFeatureFlag({
    actorId,
    featureFlag,
    isEnabled,
    prevFederatedGraphs,
  }: {
    actorId: string;
    featureFlag: FeatureFlagDTO;
    isEnabled?: boolean;
    prevFederatedGraphs?: FederatedGraphDTO[];
  }): Promise<ComposeAndDeployResult> {
    const orgFeatures = await this.#getOrganizationFeatures();
    const enabled = isEnabled ?? featureFlag.isEnabled;
    if (!orgFeatures.splitConfigLoading) {
      return await this.#legacyComposeAndDeployFeatureFlag({
        actorId,
        featureFlag,
        enabled,
        orgFeatures,
        prevFederatedGraphs,
      });
    }

    const result: ComposeAndDeployResult = {
      deploymentErrors: [],
      compositionErrors: [],
      compositionWarnings: [],
    };

    const featureFlagRepo = new FeatureFlagRepository(this.logger, this.db, this.organizationId);
    const federatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlag.id,
      namespaceId: featureFlag.namespaceId,
      excludeDisabled: enabled,
      includeContracts: true,
    });

    // If the feature flag belonged to one or more federated graphs, we need to delete the router config for the
    // graphs that are no longer associated with the feature flag
    if (prevFederatedGraphs && prevFederatedGraphs.length > 0) {
      const federatedGraphsToDeleteFrom: FederatedGraphDTO[] = [];
      for (const graph of prevFederatedGraphs) {
        if (!federatedGraphs.some((g) => g.id === graph.id)) {
          federatedGraphsToDeleteFrom.push(graph);
        }
      }

      const deleteErrors = await this.#deleteFeatureFlagConfigs(featureFlag, federatedGraphsToDeleteFrom);
      if (deleteErrors.length > 0) {
        result.deploymentErrors.push(...deleteErrors);
        return result;
      }
    }

    if (federatedGraphs.length === 0) {
      // The feature flag is not associated with any federated graphs
      return result;
    }

    if (!enabled) {
      // The feature flag is disabled; instead of recomposing, we are just going to delete the router configuration
      // from the federated graphs the feature flag is associated with
      const deleteError = await this.#deleteFeatureFlagConfigs(featureFlag, federatedGraphs);
      result.deploymentErrors.push(...deleteError);
      return result;
    }

    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const compositionOptions: CompositionOptions = {
      disableResolvabilityValidation: this.disableResolvabilityValidation,
      ignoreExternalKeys: orgFeatures.ignoreExternalKeys,
    };

    const graphAndCompositionResults: FederatedGraphAndCompositionResults[] = [];
    for (const graph of federatedGraphs) {
      // Get published subgraphs for recomposition of the federated graph
      const subgraphs = await subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: graph.targetId,
        published: true,
      });

      const baseCompositionSubgraphs = subgraphs.map((s) => ({
        name: s.name,
        url: s.routingUrl,
        definitions: parse(s.schemaSDL),
      }));

      const subgraphsToCompose = featureFlagRepo.getFeatureFlagRelatedSubgraphsToCompose(
        new Map([[featureFlag.id, featureFlag]]),
        baseCompositionSubgraphs,
        subgraphs,
        [],
      );

      const { results } = await composeGraphsInWorker({
        federatedGraph: graph,
        subgraphsToCompose: subgraphsToCompose.map((s) => ({
          subgraphs: s.subgraphs,
          isFeatureFlagComposition: s.isFeatureFlagComposition,
          featureFlagName: s.featureFlagName,
          featureFlagId: s.featureFlagId,
        })),
        /**
         * Do not recompose contracts of a base graph; if the feature flag also belongs to a contract, the
         * contract will be itself added to the `federatedGraphs` array.
         *
         * Consequently, if `graph` is a contract, pass the tag data through to the feature flag composition.
         */
        tagOptionsByContractName: graph.contract
          ? [
              {
                contractName: graph.name,
                excludeTags: graph.contract.excludeTags,
                includeTags: graph.contract.includeTags,
              },
            ]
          : [],
        compositionOptions,
      });

      graphAndCompositionResults.push({ federatedGraph: graph, results });
    }

    await this.#handleCompositionResultsAndDeploy({
      actorId,
      graphAndCompositionResults,
      result,
      isFeatureFlagComposition: true,
      splitConfig: true,
    });

    return result;
  }

  public async deleteFeatureFlag({
    actorId,
    featureFlag,
    authorize,
  }: {
    actorId: string;
    featureFlag: FeatureFlagDTO;
    authorize: (graph: FederatedGraphDTO) => Promise<void>;
  }): Promise<ComposeAndDeployResult> {
    const orgFeatures = await this.#getOrganizationFeatures();
    const featureFlagRepo = new FeatureFlagRepository(this.logger, this.db, this.organizationId);

    // Collect the federated graph DTOs that have the feature flag enabled because they will be re-composed
    const federatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlag.id,
      namespaceId: featureFlag.namespaceId,
      // if deleting when already disabled, there are no compositions to be done.
      excludeDisabled: true,
      includeContracts: orgFeatures.splitConfigLoading,
    });

    // Check that the user is authorized to delete the feature flag.
    // The user must have authorization for each related federated graph
    for (const federatedGraph of federatedGraphs) {
      // Check if the user is authorized to perform the action
      await authorize(federatedGraph);
    }

    /**
     * We need to have the actual deletion here because the legacy implementation needs the feature flag to be
     * deleted before composition; however, v2 needs it to happen after we know the graphs the feature flag is applied
     * to because, instead of recomposing everything, we just remove the feature flag composition.
     */
    await featureFlagRepo.delete(featureFlag.id);

    if (!orgFeatures.splitConfigLoading) {
      return await this.#legacyComposeAndDeploy({
        actorId,
        federatedGraphs,
        compositionOptions: {
          disableResolvabilityValidation: this.disableResolvabilityValidation,
          ignoreExternalKeys: orgFeatures.ignoreExternalKeys,
        },
      });
    }

    return {
      deploymentErrors: await this.#deleteFeatureFlagConfigs(featureFlag, federatedGraphs),
      compositionErrors: [],
      compositionWarnings: [],
    };
  }

  async recomposeAndDeployAffected({
    actorId,
    affectedFederatedGraphs,
    affectedFeatureFlags,
    isFeatureSubgraph,
  }: {
    actorId: string;
    affectedFederatedGraphs: FederatedGraphDTO[];
    affectedFeatureFlags: FeatureFlagDTO[];
    isFeatureSubgraph: boolean;
  }): Promise<ComposeAndDeployResult> {
    const orgFeatures = await this.#getOrganizationFeatures();
    if (!orgFeatures.splitConfigLoading) {
      return await this.#legacyComposeAndDeploy({
        actorId,
        federatedGraphs: affectedFederatedGraphs,
        compositionOptions: {
          disableResolvabilityValidation: this.disableResolvabilityValidation,
          ignoreExternalKeys: orgFeatures.ignoreExternalKeys,
        },
      });
    }

    const result: ComposeAndDeployResult = {
      deploymentErrors: [],
      compositionErrors: [],
      compositionWarnings: [],
    };

    // Compose all affected federated graphs only when the subgraph we are updating is not a feature subgraph
    // as these should not affect federated graphs
    if (!isFeatureSubgraph) {
      for (const federatedGraph of affectedFederatedGraphs) {
        const { deploymentErrors, compositionErrors, compositionWarnings } = await this.composeAndDeployFederatedGraph({
          actorId,
          federatedGraph,
        });

        result.deploymentErrors.push(...deploymentErrors);
        result.compositionErrors.push(...compositionErrors);
        result.compositionWarnings.push(...compositionWarnings);
      }
    }

    // Compose all affected feature flags
    for (const featureFlag of affectedFeatureFlags) {
      const { deploymentErrors, compositionErrors, compositionWarnings } = await this.composeAndDeployFeatureFlag({
        actorId,
        featureFlag,
        isEnabled: true,
      });

      result.deploymentErrors.push(...deploymentErrors);
      result.compositionErrors.push(...compositionErrors);
      result.compositionWarnings.push(...compositionWarnings);
    }

    return result;
  }

  async #getOrganizationFeatures(): Promise<OrganizationFeatures> {
    const orgRepo = new OrganizationRepository(this.logger, this.db);
    const ignoreExternalKeysFeature = await orgRepo.getFeature({
      organizationId: this.organizationId,
      featureId: COMPOSITION_IGNORE_EXTERNAL_KEYS_FEATURE_ID,
    });

    const splitConfigFeature = await orgRepo.getFeature({
      organizationId: this.organizationId,
      featureId: SPLIT_CONFIG_LOADING_FEATURE_ID,
    });

    return {
      ignoreExternalKeys: ignoreExternalKeysFeature?.enabled ?? false,
      splitConfigLoading: splitConfigFeature?.enabled ?? false,
    };
  }

  async #legacyComposeAndDeploy({
    actorId,
    federatedGraphs,
    compositionOptions,
  }: {
    actorId: string;
    federatedGraphs: FederatedGraphDTO[];
    compositionOptions?: CompositionOptions;
  }): Promise<ComposeAndDeployResult> {
    const result: ComposeAndDeployResult = {
      deploymentErrors: [],
      compositionErrors: [],
      compositionWarnings: [],
    };

    if (federatedGraphs.length === 0) {
      return result;
    }

    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const contractRepo = new ContractRepository(this.logger, this.db, this.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(this.logger, this.db, this.organizationId);

    const graphAndCompositionResults: FederatedGraphAndCompositionResults[] = [];
    for (const graph of federatedGraphs) {
      // Get published subgraphs for recomposition of the federated graph
      const subgraphs = await subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: graph.targetId,
        published: true,
      });

      const contracts = await contractRepo.bySourceFederatedGraphId(graph.id);
      const tagOptionsByContractName = contracts.map((contract) => ({
        contractName: contract.downstreamFederatedGraph.target.name,
        excludeTags: contract.excludeTags,
        includeTags: contract.includeTags,
      }));

      const baseCompositionSubgraphs = subgraphs.map((s) => ({
        name: s.name,
        url: s.routingUrl,
        definitions: parse(s.schemaSDL),
      }));

      // Collects the base graph and applicable feature flag-related graphs
      const allSubgraphsToCompose: SubgraphsToCompose[] = await featureFlagRepo.getSubgraphsToCompose({
        baseSubgraphs: subgraphs,
        baseCompositionSubgraphs,
        fedGraphLabelMatchers: graph.labelMatchers,
      });

      const { results } = await composeGraphsInWorker({
        federatedGraph: graph,
        subgraphsToCompose: allSubgraphsToCompose.map((g) => ({
          subgraphs: g.subgraphs,
          isFeatureFlagComposition: g.isFeatureFlagComposition,
          featureFlagName: g.featureFlagName,
          featureFlagId: g.featureFlagId,
        })),
        tagOptionsByContractName,
        compositionOptions,
      });

      graphAndCompositionResults.push({ federatedGraph: graph, results });
    }

    await this.#handleCompositionResultsAndDeploy({ actorId, graphAndCompositionResults, result });
    return result;
  }

  async #legacyComposeAndDeployFeatureFlag({
    actorId,
    featureFlag,
    enabled,
    orgFeatures,
    prevFederatedGraphs,
  }: {
    actorId: string;
    featureFlag: FeatureFlagDTO;
    enabled: boolean;
    orgFeatures: OrganizationFeatures;
    prevFederatedGraphs?: FederatedGraphDTO[];
  }) {
    const featureFlagRepo = new FeatureFlagRepository(this.logger, this.db, this.organizationId);
    const currentGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlag.id,
      namespaceId: featureFlag.namespaceId,
      excludeDisabled: enabled,
    });

    const allFederatedGraphIdsToCompose = new Set<string>();
    const allFederatedGraphsToCompose: FederatedGraphDTO[] = [];
    for (const graph of [...(prevFederatedGraphs ?? []), ...currentGraphs]) {
      if (!allFederatedGraphIdsToCompose.has(graph.id)) {
        allFederatedGraphIdsToCompose.add(graph.id);
        allFederatedGraphsToCompose.push(graph);
      }
    }

    return await this.#legacyComposeAndDeploy({
      actorId,
      federatedGraphs: allFederatedGraphsToCompose,
      compositionOptions: {
        disableResolvabilityValidation: this.disableResolvabilityValidation,
        ignoreExternalKeys: orgFeatures.ignoreExternalKeys,
      },
    });
  }

  #getManifestBasePath(federatedGraphId: string): string {
    return `${this.organizationId}/${federatedGraphId}/manifest`;
  }

  #getLatestPath(graph: FederatedGraphDTO): string | undefined {
    let versionPath = '';
    if (graph.routerCompatibilityVersion !== ROUTER_COMPATIBILITY_VERSION_ONE) {
      if (ROUTER_COMPATIBILITY_VERSIONS.has(graph.routerCompatibilityVersion as SupportedRouterCompatibilityVersion)) {
        versionPath = `${graph.routerCompatibilityVersion}/`;
      } else {
        return undefined;
      }
    }

    return `${versionPath}latest.json`;
  }

  async #updateMapperForFederatedGraph(federatedGraphId: string): Promise<void> {
    const routerHashesForGraph = await this.db
      .select({
        id: schema.routerConfigHash.id,
        hash: schema.routerConfigHash.hash,
        featureFlagName: schema.featureFlags.name,
      })
      .from(schema.routerConfigHash)
      .leftJoin(schema.featureFlags, eq(schema.featureFlags.id, schema.routerConfigHash.featureFlagId))
      .where(eq(schema.routerConfigHash.federatedGraphId, federatedGraphId))
      .execute();

    // Load hashes from database
    const mapper = new Map<string, string>();
    for (const routerHash of routerHashesForGraph) {
      mapper.set(routerHash.featureFlagName ?? '', routerHash.hash);
    }

    // Serialize the mapper
    const serializableMapper: Record<string, string> = {};
    for (const [key, value] of mapper) {
      serializableMapper[key] = value;
    }

    // Serialize the mapper content and generate the file signature
    const mapperVersion = randomUUID();
    const mapperContent = JSON.stringify(serializableMapper);
    const signatureSha256 = createHash('sha256').update(mapperVersion).update(mapperContent).digest('hex');

    // Upload the mapper file to the CDN
    await this.blobStorage.putObject({
      key: `${this.#getManifestBasePath(federatedGraphId)}/mapper.json`,
      body: Buffer.from(mapperContent, 'utf8'),
      contentType: 'application/json; charset=utf-8',
      metadata: {
        version: mapperVersion,
        'signature-sha256': signatureSha256,
      },
    });
  }

  async #deleteFeatureFlagConfigs(
    featureFlag: FeatureFlagDTO,
    federatedGraphs: FederatedGraphDTO[],
  ): Promise<PlainMessage<DeploymentError>[]> {
    if (federatedGraphs.length === 0) {
      return [];
    }

    // First, we need to delete all the hashes from the database, so we can correctly update the mapper files
    await this.db
      .delete(schema.routerConfigHash)
      .where(
        and(
          eq(schema.routerConfigHash.featureFlagId, featureFlag.id),
          inArray(
            schema.routerConfigHash.federatedGraphId,
            federatedGraphs.map((graph) => graph.id),
          ),
        ),
      )
      .execute();

    // Then, we can proceed with deleting the router config for the feature flag and update the mapper files
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];
    await Promise.all(
      federatedGraphs.map(async (graph) => {
        try {
          await this.blobStorage.deleteObject({
            key: `${this.#getManifestBasePath(graph.id)}/feature-flags/${featureFlag.name}.json`,
          });

          await this.#updateMapperForFederatedGraph(graph.id);
        } catch (err) {
          if (err instanceof Error) {
            deploymentErrors.push({
              message: err.message,
              namespace: graph.namespace,
              federatedGraphName: graph.name,
            });
          }
        }
      }),
    );

    return deploymentErrors;
  }

  async #handleCompositionResult({
    actorId,
    federatedGraph,
    compositionResult,
    result,
    composer,
    baseCompositionData,
  }: {
    actorId: string;
    federatedGraph: FederatedGraphDTO;
    compositionResult: ComposeGraphsTaskResultItem;
    result: ComposeAndDeployResult;
    composer: Composer;
    baseCompositionData: BaseCompositionData;
  }): Promise<{
    baseCompositionFailed: boolean;
    federatedSchemaVersionId: string;
    baseComposedGraph: DeserializedComposedGraph;
    routerExecutionConfig: RouterConfig | undefined;
  }> {
    if (!compositionResult.base.success) {
      // Collect all composition errors
      result.compositionErrors.push(
        ...compositionResult.base.errors.map((message) => ({
          federatedGraphName: federatedGraph.name,
          namespace: federatedGraph.namespace,
          message,
          featureFlag: compositionResult.featureFlagName || '',
        })),
      );
    }

    // Collect all composition warnings
    result.compositionWarnings.push(
      ...compositionResult.base.warnings.map((warning) => ({
        federatedGraphName: federatedGraph.name,
        namespace: federatedGraph.namespace,
        message: warning.message,
        featureFlag: compositionResult.featureFlagName || '',
      })),
    );

    if (!compositionResult.isFeatureFlagComposition && !compositionResult.base.success && !federatedGraph.contract) {
      result.compositionErrors.push(unsuccessfulBaseCompositionError(federatedGraph.name, federatedGraph.namespace));
    }

    const federatedSchemaVersionId = randomUUID();
    const baseComposedGraph = deserializeComposedGraphArtifact(federatedGraph, compositionResult.base);
    let routerExecutionConfig: RouterConfig | undefined;
    if (compositionResult.base.success) {
      if (!compositionResult.base.routerExecutionConfigJson) {
        throw new Error(
          `Successful composition for federated graph "${federatedGraph.name}" does not contain a router execution config.`,
        );
      }

      routerExecutionConfig = deserializeRouterExecutionConfig(compositionResult.base.routerExecutionConfigJson);
    }

    if (routerExecutionConfig) {
      routerExecutionConfig.version = federatedSchemaVersionId;
    }

    const baseComposition = await composer.saveComposition({
      composedGraph: baseComposedGraph,
      composedById: actorId,
      isFeatureFlagComposition: compositionResult.isFeatureFlagComposition,
      federatedSchemaVersionId,
      routerExecutionConfig,
      featureFlagId: compositionResult.featureFlagId,
    });

    if (!compositionResult.base.success || !baseComposition.schemaVersionId) {
      /*
       * If the base composition failed to compose or deploy, return to the parent loop, because
       * contracts are not composed if the base composition fails.
       */
      if (!compositionResult.isFeatureFlagComposition) {
        return {
          baseCompositionFailed: true,
          federatedSchemaVersionId,
          baseComposedGraph,
          routerExecutionConfig,
        };
      }

      // Record the feature flag composition to upload (if there are no errors)
    } else if (compositionResult.isFeatureFlagComposition) {
      if (!routerExecutionConfig) {
        throw new Error(
          `Successful feature flag composition for federated graph "${federatedGraph.name}" does not contain a router execution config.`,
        );
      }

      baseCompositionData.featureFlagRouterExecutionConfigByFeatureFlagName.set(
        compositionResult.featureFlagName,
        routerConfigToFeatureFlagExecutionConfig(routerExecutionConfig),
      );

      // Otherwise, this is the base composition, so store the schema version id
    } else {
      if (!routerExecutionConfig) {
        throw new Error(
          `Successful composition for federated graph "${federatedGraph.name}" does not contain a router execution config.`,
        );
      }

      baseCompositionData.schemaVersionId = baseComposition.schemaVersionId;
      baseCompositionData.routerExecutionConfig = routerExecutionConfig;
    }

    return {
      baseCompositionFailed: false,
      federatedSchemaVersionId,
      baseComposedGraph,
      routerExecutionConfig,
    };
  }

  async #handleCompositionResultsAndDeploy({
    actorId,
    graphAndCompositionResults,
    result,
    isFeatureFlagComposition = false,
    splitConfig = false,
  }: {
    actorId: string;
    graphAndCompositionResults: FederatedGraphAndCompositionResults[];
    result: ComposeAndDeployResult;
    isFeatureFlagComposition?: boolean;
    splitConfig?: boolean;
  }): Promise<void> {
    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
    const composer = new Composer(
      this.logger,
      this.db,
      fedGraphRepo,
      new SubgraphRepository(this.logger, this.db, this.organizationId),
      new ContractRepository(this.logger, this.db, this.organizationId),
      new GraphCompositionRepository(this.logger, this.db),
      this.chClient,
      this.webhookProxyUrl,
    );

    parentLoop: for (const { federatedGraph, results } of graphAndCompositionResults) {
      /*
       * baseCompositionData contains the router execution config and the schema version ID for the source graph
       * base composition (not a contract or feature flag composition)
       */
      const baseCompositionData: BaseCompositionData = {
        featureFlagRouterExecutionConfigByFeatureFlagName: new Map<string, FeatureFlagRouterExecutionConfig>(),
      };

      /*
       * Map of the contract base composition schema version ID, router execution config,
       * and any feature flag schema version IDs by contract ID
       */
      const contractBaseCompositionDataByContractId = new Map<string, ContractBaseCompositionData>();

      for (const compositionResult of results) {
        const { baseCompositionFailed } = await this.#handleCompositionResult({
          actorId,
          federatedGraph,
          compositionResult,
          result,
          composer,
          baseCompositionData,
        });

        if (baseCompositionFailed) {
          continue parentLoop;
        }

        // If there are no contracts, there is nothing further to do
        if (compositionResult.contracts.length === 0) {
          continue;
        }

        for (const { contractName, artifact } of compositionResult.contracts) {
          const contractGraph = await fedGraphRepo.byName(contractName, federatedGraph.namespace);
          if (!contractGraph) {
            throw new Error(`The contract graph "${contractName}" was not found.`);
          }

          if (!artifact.success) {
            result.compositionErrors.push(
              ...artifact.errors.map((message) => ({
                federatedGraphName: contractGraph.name,
                namespace: contractGraph.namespace,
                message,
                featureFlag: compositionResult.featureFlagName,
              })),
            );
          }

          result.compositionWarnings.push(
            ...artifact.warnings.map((warning) => ({
              federatedGraphName: contractGraph.name,
              namespace: contractGraph.namespace,
              message: warning.message,
              featureFlag: compositionResult.featureFlagName,
            })),
          );

          const contractSchemaVersionId = randomUUID();
          const contractComposedGraph = deserializeComposedGraphArtifact(contractGraph, artifact);
          let contractRouterExecutionConfig;
          if (artifact.success) {
            if (!artifact.routerExecutionConfigJson) {
              throw new Error(
                `Successful contract composition for federated graph "${contractGraph.name}" does not contain a router execution config.`,
              );
            }

            contractRouterExecutionConfig = deserializeRouterExecutionConfig(artifact.routerExecutionConfigJson);
            if (!contractRouterExecutionConfig) {
              throw new Error(
                `Successful contract composition for federated graph "${contractGraph.name}" did not produce a router execution config.`,
              );
            }

            contractRouterExecutionConfig.version = contractSchemaVersionId;
          }

          const contractComposition = await composer.saveComposition({
            composedGraph: contractComposedGraph,
            composedById: actorId,
            isFeatureFlagComposition: compositionResult.isFeatureFlagComposition,
            federatedSchemaVersionId: contractSchemaVersionId,
            routerExecutionConfig: contractRouterExecutionConfig,
            featureFlagId: compositionResult.featureFlagId,
          });

          if (!artifact.success || !contractComposition.schemaVersionId) {
            continue;
          }

          if (!contractRouterExecutionConfig) {
            throw new Error(
              `Successful contract composition for federated graph "${contractGraph.name}" did not produce a router execution config.`,
            );
          }

          /*
           * If the base composition for which this contract has been made is NOT a feature flag composition,
           * it must be the contract base composition, which must always be uploaded.
           * The base composition is always the first item in the subgraphsToCompose array.
           */
          if (!compositionResult.isFeatureFlagComposition) {
            contractBaseCompositionDataByContractId.set(contractGraph.id, {
              schemaVersionId: contractComposition.schemaVersionId,
              routerExecutionConfig: contractRouterExecutionConfig,
              featureFlagRouterExecutionConfigByFeatureFlagName: new Map<string, FeatureFlagRouterExecutionConfig>(),
            });

            continue;
          }

          /*
           * If the contract has a feature flag, get the current array feature flag versions (or set a new one),
           * and then push the current schema version to the array
           */
          const existingContractBaseCompositionData = contractBaseCompositionDataByContractId.get(contractGraph.id);

          /*
           * If the existingContractSchemaVersions is undefined, it means the contract base composition failed.
           * In this case, simply continue, because when iterating a feature flag for the source graph composition,
           * there may not be any errors for the feature flag.
           */
          if (!existingContractBaseCompositionData) {
            continue;
          }

          existingContractBaseCompositionData.featureFlagRouterExecutionConfigByFeatureFlagName.set(
            compositionResult.featureFlagName,
            routerConfigToFeatureFlagExecutionConfig(contractRouterExecutionConfig),
          );
        }
      }

      // Validate composition result
      const graph = await fedGraphRepo.byId(federatedGraph.id);
      if (!graph) {
        throw new Error(`Fatal: The federated graph "${federatedGraph.name}" was not found.`);
      }

      if (isFeatureFlagComposition) {
        await this.#deployFeatureFlags(
          actorId,
          graph,
          baseCompositionData.featureFlagRouterExecutionConfigByFeatureFlagName,
          composer,
          result,
        );
      } else {
        if (!baseCompositionData.routerExecutionConfig) {
          throw new Error(
            `Fatal: The latest router execution config for federated graph "${federatedGraph.name}" was not generated.`,
          );
        }

        if (!baseCompositionData.schemaVersionId) {
          throw new Error(
            `Fatal: The latest base composition for federated graph "${federatedGraph.name}" was not found.`,
          );
        }

        await this.#deployGraph({
          actorId,
          routerExecutionConfig: baseCompositionData.routerExecutionConfig,
          graph,
          schemaVersionId: baseCompositionData.schemaVersionId,
          featureFlagRouterExecutionConfigByFeatureFlagName:
            baseCompositionData.featureFlagRouterExecutionConfigByFeatureFlagName,
          composer,
          result,
          splitConfig,
        });
      }

      if (splitConfig) {
        await this.#updateMapperForFederatedGraph(federatedGraph.id);
      }

      // Handle contracts
      for (const [
        contractId,
        { featureFlagRouterExecutionConfigByFeatureFlagName, schemaVersionId, routerExecutionConfig },
      ] of contractBaseCompositionDataByContractId) {
        const contractDTO = await fedGraphRepo.byId(contractId);
        if (!contractDTO) {
          throw new Error(`Unexpected: Contract graph with id "${contractId}" not found after latest composition`);
        }

        await this.#deployGraph({
          actorId,
          routerExecutionConfig,
          graph: contractDTO,
          schemaVersionId,
          featureFlagRouterExecutionConfigByFeatureFlagName,
          composer,
          result,
          splitConfig,
        });

        if (splitConfig) {
          await this.#updateMapperForFederatedGraph(contractDTO.id);
        }
      }
    }
  }

  async #deployGraph({
    actorId,
    routerExecutionConfig,
    graph,
    schemaVersionId,
    featureFlagRouterExecutionConfigByFeatureFlagName,
    composer,
    result,
    splitConfig,
  }: {
    actorId: string;
    routerExecutionConfig: RouterConfig;
    graph: FederatedGraphDTO;
    schemaVersionId: string;
    featureFlagRouterExecutionConfigByFeatureFlagName: Map<string, FeatureFlagRouterExecutionConfig>;
    composer: Composer;
    result: ComposeAndDeployResult;
    splitConfig: boolean;
  }) {
    const manifestBasePath = this.#getManifestBasePath(graph.id);
    const readyPathOverride = this.#getLatestPath(graph);
    if (readyPathOverride) {
      const { errors: uploadErrors } = await composer.composeAndUploadRouterConfig({
        admissionConfig: {
          cdnBaseUrl: this.admissionConfig.cdnBaseUrl,
          jwtSecret: this.admissionConfig.webhookJWTSecret,
        },
        baseCompositionRouterExecutionConfig: routerExecutionConfig,
        baseCompositionSchemaVersionId: schemaVersionId,
        blobStorage: this.blobStorage,
        featureFlagRouterExecutionConfigByFeatureFlagName: splitConfig
          ? new Map<string, FeatureFlagRouterExecutionConfig>() // Do not populate feature flags when the router config is being split
          : featureFlagRouterExecutionConfigByFeatureFlagName,
        federatedGraphId: graph.id,
        organizationId: this.organizationId,
        federatedGraphAdmissionWebhookURL: graph.admissionWebhookURL,
        federatedGraphAdmissionWebhookSecret: graph.admissionWebhookSecret,
        actorId,
        pathOverride: splitConfig
          ? {
              ready: `${manifestBasePath}/${readyPathOverride}`,
              draft: `${manifestBasePath}/draft.json`,
            }
          : undefined,
      });

      if (splitConfig) {
        await this.#saveRouterConfigHash(graph.id, undefined, routerExecutionConfig);
      }

      result.deploymentErrors.push(
        ...uploadErrors
          .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
          .map((e) => ({
            federatedGraphName: graph.name,
            namespace: graph.namespace,
            message: e.message ?? '',
          })),
      );
    } else {
      result.deploymentErrors.push({
        message: `Invalid router compatibility version "${graph.routerCompatibilityVersion}".`,
        federatedGraphName: graph.name,
        namespace: graph.namespace,
      });
    }

    if (splitConfig && featureFlagRouterExecutionConfigByFeatureFlagName.size > 0) {
      await this.#deployFeatureFlags(
        actorId,
        graph,
        featureFlagRouterExecutionConfigByFeatureFlagName,
        composer,
        result,
      );
    }
  }

  async #deployFeatureFlags(
    actorId: string,
    graph: FederatedGraphDTO,
    featureFlagRouterExecutionConfigByFeatureFlagName: Map<string, FeatureFlagRouterExecutionConfig>,
    composer: Composer,
    result: ComposeAndDeployResult,
  ): Promise<void> {
    const baseManifestPath = this.#getManifestBasePath(graph.id);
    for (const [
      featureFlagName,
      featureFlagRouterExecutionConfig,
    ] of featureFlagRouterExecutionConfigByFeatureFlagName.entries()) {
      const routerExecutionConfig = RouterConfig.fromJson({
        ...(featureFlagRouterExecutionConfig.toJson() as JsonObject),
        compatibilityVersion: graph.routerCompatibilityVersion,
      });

      const { errors: uploadErrors } = await composer.composeAndUploadRouterConfig({
        admissionConfig: {
          cdnBaseUrl: this.admissionConfig.cdnBaseUrl,
          jwtSecret: this.admissionConfig.webhookJWTSecret,
        },
        baseCompositionRouterExecutionConfig: routerExecutionConfig,
        baseCompositionSchemaVersionId: '',
        blobStorage: this.blobStorage,
        featureFlagRouterExecutionConfigByFeatureFlagName: new Map(),
        federatedGraphId: graph.id,
        organizationId: this.organizationId,
        federatedGraphAdmissionWebhookURL: graph.admissionWebhookURL,
        federatedGraphAdmissionWebhookSecret: graph.admissionWebhookSecret,
        actorId,
        pathOverride: {
          ready: `${baseManifestPath}/feature-flags/${featureFlagName}.json`,
          draft: `${baseManifestPath}/feature-flags/${featureFlagName}.draft.json`,
        },
      });

      await this.#saveRouterConfigHash(graph.id, featureFlagName, routerExecutionConfig);
      result.deploymentErrors.push(
        ...uploadErrors
          .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
          .map((e) => ({
            federatedGraphName: graph.name,
            namespace: graph.namespace,
            message: e.message ?? '',
          })),
      );
    }
  }

  async #saveRouterConfigHash(
    federatedGraphId: string,
    featureFlagName: string | undefined,
    routerConfig: RouterConfig,
  ): Promise<void> {
    const hash = createHash('sha256').update(routerConfig.toJsonString()).digest('hex');

    let featureFlag: { id: string } | undefined;
    if (featureFlagName) {
      const results = await this.db
        .select({ id: schema.featureFlags.id })
        .from(schema.featureFlags)
        .where(
          and(
            eq(schema.featureFlags.organizationId, this.organizationId),
            eq(schema.featureFlags.name, featureFlagName),
          ),
        )
        .limit(1)
        .execute();

      featureFlag = results[0];
    }

    await this.db
      .insert(schema.routerConfigHash)
      .values({ federatedGraphId, featureFlagId: featureFlag?.id ?? null, hash })
      .onConflictDoUpdate({
        target: [schema.routerConfigHash.federatedGraphId, schema.routerConfigHash.featureFlagId],
        set: { hash, updatedAt: new Date() },
      })
      .execute();
  }
}
