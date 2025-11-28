import { Subgraph } from '@wundergraph/composition';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { SQL, and, asc, count, eq, inArray, like, or, sql, arrayOverlaps } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { validate as isValidUuid } from 'uuid';
import { parse } from 'graphql';
import * as schema from '../../db/schema.js';
import {
  featureFlagToFeatureSubgraphs,
  featureFlags,
  featureSubgraphsToBaseSubgraphs,
  federatedGraphsToFeatureFlagSchemaVersions,
  graphCompositions,
  namespaces,
  schemaVersion,
  subgraphs,
  subgraphsToFederatedGraph,
  targets,
  users,
} from '../../db/schema.js';
import {
  FeatureFlagCompositionDTO,
  FeatureFlagDTO,
  FeatureSubgraphDTO,
  FederatedGraphDTO,
  Label,
  ProtoSubgraph,
  SubgraphDTO,
} from '../../types/index.js';
import { normalizeLabels } from '../util.js';
import { RBACEvaluator } from '../services/RBACEvaluator.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { UserRepository } from './UserRepository.js';

export interface FeatureFlagWithFeatureSubgraphs {
  id: string;
  name: string;
  featureSubgraphs: FeatureSubgraphDTO[];
}

export interface SubgraphsToCompose {
  compositionSubgraphs: Subgraph[];
  subgraphs: SubgraphDTO[];
  isFeatureFlagComposition: boolean;
  featureFlagName: string;
  featureFlagId: string;
}

export interface FeatureFlagListFilterOptions {
  namespaceId?: string;
  limit: number;
  offset: number;
  query?: string;
  rbac?: RBACEvaluator;
}

export type CheckConstituentFeatureSubgraphsResult = {
  errorMessages: Array<string>;
  featureSubgraphIds: Array<string>;
};

export class FeatureFlagRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public createFeatureFlag({
    name,
    namespaceId,
    labels,
    createdBy,
    featureSubgraphIds,
    isEnabled,
  }: {
    name: string;
    namespaceId: string;
    labels: Label[];
    createdBy: string;
    featureSubgraphIds: string[];
    isEnabled: boolean;
  }) {
    const uniqueLabels = normalizeLabels(labels);
    return this.db.transaction(async (tx) => {
      const featureFlag = await tx
        .insert(featureFlags)
        .values({
          name,
          organizationId: this.organizationId,
          namespaceId,
          createdBy,
          isEnabled,
          labels: uniqueLabels.map((ul) => joinLabel(ul)),
        })
        .returning()
        .execute();
      if (featureSubgraphIds.length > 0) {
        await tx.insert(featureFlagToFeatureSubgraphs).values(
          featureSubgraphIds.map((featureSubgraphId) => ({
            featureFlagId: featureFlag[0].id,
            featureSubgraphId,
          })),
        );
      }
      return featureFlag[0];
    });
  }

  public updateFeatureFlag({
    featureFlag,
    labels,
    featureSubgraphIds,
    unsetLabels,
  }: {
    featureFlag: FeatureFlagDTO;
    labels: Label[];
    featureSubgraphIds: string[];
    unsetLabels: boolean;
  }) {
    const uniqueLabels = normalizeLabels(labels);
    return this.db.transaction(async (tx) => {
      if (labels.length > 0 || unsetLabels) {
        const newLabels = unsetLabels ? [] : uniqueLabels;
        await tx
          .update(featureFlags)
          .set({
            labels: newLabels.map((ul) => joinLabel(ul)),
          })
          .where(and(eq(featureFlags.id, featureFlag.id), eq(featureFlags.organizationId, this.organizationId)))
          .execute();
      }

      if (featureSubgraphIds.length > 0) {
        // delete all the feature subgraphs of the feature flag
        await tx
          .delete(featureFlagToFeatureSubgraphs)
          .where(eq(featureFlagToFeatureSubgraphs.featureFlagId, featureFlag.id))
          .execute();

        await tx.insert(featureFlagToFeatureSubgraphs).values(
          featureSubgraphIds.map((featureSubgraphId) => ({
            featureFlagId: featureFlag.id,
            featureSubgraphId,
          })),
        );
      }
    });
  }

  public async enableFeatureFlag({
    featureFlagId,
    namespaceId,
    isEnabled,
  }: {
    featureFlagId: string;
    namespaceId: string;
    isEnabled: boolean;
  }) {
    await this.db
      .update(featureFlags)
      .set({ isEnabled, updatedAt: new Date() })
      .where(
        and(
          eq(featureFlags.id, featureFlagId),
          eq(featureFlags.organizationId, this.organizationId),
          eq(featureFlags.namespaceId, namespaceId),
        ),
      )
      .execute();
  }

  public async getFeatureFlags({ namespaceId, limit, offset, query }: FeatureFlagListFilterOptions) {
    const conditions: SQL<unknown>[] = [eq(featureFlags.organizationId, this.organizationId)];

    if (query) {
      conditions.push(like(featureFlags.name, `%${query}%`));
    }

    if (namespaceId) {
      conditions.push(eq(featureFlags.namespaceId, namespaceId));
    }

    const dbQuery = this.db
      .select({
        id: featureFlags.id,
        name: featureFlags.name,
        namespace: namespaces.name,
        labels: featureFlags.labels,
        isEnabled: featureFlags.isEnabled,
        createdAt: featureFlags.createdAt,
        createdBy: users.email,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
      .innerJoin(namespaces, eq(namespaces.id, featureFlags.namespaceId))
      .leftJoin(users, eq(users.id, featureFlags.createdBy))
      .where(and(...conditions));

    if (limit) {
      dbQuery.limit(limit);
    }

    if (offset) {
      dbQuery.offset(offset);
    }

    const resp = await dbQuery.execute();

    return resp.map((r) => ({
      ...r,
      labels: r.labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt?.toISOString() || '',
      createdBy: r.createdBy || '',
    }));
  }

  public async getFeatureFlagsCount({ namespaceId }: { namespaceId?: string }) {
    const conditions: SQL<unknown>[] = [eq(featureFlags.organizationId, this.organizationId)];
    if (namespaceId) {
      conditions.push(eq(featureFlags.namespaceId, namespaceId));
    }

    const featureFlagsCount = await this.db
      .select({
        count: count(),
      })
      .from(featureFlags)
      .where(and(...conditions))
      .execute();

    if (featureFlagsCount.length === 0) {
      return 0;
    }

    return featureFlagsCount[0].count;
  }

  /**
   * Applies conditions based on the provided RBAC. If the actor can't access any subgraph, the
   * returned value is false; otherwise, true.
   *
   * @param rbac
   * @param conditions
   * @private
   */
  private applyRbacConditionsToQuery(rbac: RBACEvaluator | undefined, conditions: (SQL<unknown> | undefined)[]) {
    if (!rbac || rbac.isOrganizationAdminOrDeveloper) {
      return true;
    }

    const graphAdmin = rbac.ruleFor('subgraph-admin');
    const graphPublisher = rbac.ruleFor('subgraph-publisher');
    const graphViewer = rbac.ruleFor('subgraph-viewer');
    if (!graphAdmin && !graphPublisher && !graphViewer) {
      return false;
    }

    const namespaces: string[] = [];
    const resources: string[] = [];

    if (graphAdmin) {
      namespaces.push(...graphAdmin.namespaces);
      resources.push(...graphAdmin.resources);
    }

    if (graphPublisher) {
      namespaces.push(...graphPublisher.namespaces);
      resources.push(...graphPublisher.resources);
    }

    if (graphViewer) {
      namespaces.push(...graphViewer.namespaces);
      resources.push(...graphViewer.resources);
    }

    if (namespaces.length > 0 && resources.length > 0) {
      conditions.push(
        or(
          inArray(schema.targets.namespaceId, [...new Set(namespaces)]),
          inArray(schema.targets.id, [...new Set(resources)]),
        ),
      );
    } else if (namespaces.length > 0) {
      conditions.push(inArray(schema.targets.namespaceId, [...new Set(namespaces)]));
    } else if (resources.length > 0) {
      conditions.push(inArray(schema.targets.id, [...new Set(resources)]));
    }

    return true;
  }

  public async getFeatureSubgraphs({
    namespaceId,
    limit,
    offset,
    query,
    rbac,
  }: FeatureFlagListFilterOptions): Promise<FeatureSubgraphDTO[]> {
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const conditions: (SQL<unknown> | undefined)[] = [
      eq(targets.organizationId, this.organizationId),
      eq(targets.type, 'subgraph'),
      eq(subgraphs.isFeatureSubgraph, true),
    ];

    if (namespaceId) {
      conditions.push(eq(targets.namespaceId, namespaceId));
    }

    if (query) {
      conditions.push(isValidUuid(query) ? eq(subgraphs.id, query) : like(schema.targets.name, `%${query}%`));
    }

    if (!this.applyRbacConditionsToQuery(rbac, conditions)) {
      return [];
    }

    const dbQuery = this.db
      .select({
        id: targets.id,
        name: targets.name,
        baseSubgraphId: featureSubgraphsToBaseSubgraphs.baseSubgraphId,
      })
      .from(targets)
      .innerJoin(subgraphs, eq(subgraphs.targetId, targets.id))
      .innerJoin(featureSubgraphsToBaseSubgraphs, eq(subgraphs.id, featureSubgraphsToBaseSubgraphs.featureSubgraphId))
      // Left join because version is optional
      .leftJoin(schemaVersion, eq(subgraphs.schemaVersionId, schemaVersion.id))
      .orderBy(asc(targets.createdAt), asc(schemaVersion.createdAt))
      .where(and(...conditions));

    if (limit) {
      dbQuery.limit(limit);
    }

    if (offset) {
      dbQuery.offset(offset);
    }

    const featureSubgraphTargets = await dbQuery.execute();

    const featureSubgraphs: FeatureSubgraphDTO[] = [];

    for (const f of featureSubgraphTargets) {
      const fs = await subgraphRepo.byTargetId(f.id);
      if (!fs) {
        continue;
      }

      const baseSubgraph = await subgraphRepo.byId(f.baseSubgraphId);
      if (!baseSubgraph) {
        continue;
      }

      featureSubgraphs.push({
        ...fs,
        baseSubgraphId: f.baseSubgraphId,
        baseSubgraphName: baseSubgraph.name,
      });
    }

    return featureSubgraphs;
  }

  public async getFeatureSubgraphsCount({ namespaceId, query, rbac }: FeatureFlagListFilterOptions) {
    const conditions: SQL<unknown>[] = [
      eq(targets.organizationId, this.organizationId),
      eq(targets.type, 'subgraph'),
      eq(subgraphs.isFeatureSubgraph, true),
    ];

    if (namespaceId) {
      conditions.push(eq(targets.namespaceId, namespaceId));
    }

    if (query) {
      conditions.push(like(targets.name, `%${query}%`));
    }

    if (!this.applyRbacConditionsToQuery(rbac, conditions)) {
      return 0;
    }

    const featureSubgraphTargets = await this.db
      .select({
        count: count(),
      })
      .from(targets)
      .innerJoin(subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .where(and(...conditions));

    return featureSubgraphTargets[0].count;
  }

  private async getFeatureFlag({
    conditions,
    namespaceId,
  }: {
    conditions: SQL<unknown>[];
    namespaceId: string;
  }): Promise<FeatureFlagDTO | undefined> {
    const resp = await this.db
      .select({
        id: featureFlags.id,
        name: featureFlags.name,
        namespaceId: featureFlags.namespaceId,
        namespace: namespaces.name,
        labels: featureFlags.labels,
        creatorUserId: featureFlags.createdBy,
        isEnabled: featureFlags.isEnabled,
        organizationId: featureFlags.organizationId,
        createdAt: featureFlags.createdAt,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
      .innerJoin(namespaces, eq(namespaces.id, featureFlags.namespaceId))
      .where(and(...conditions))
      .execute();
    if (resp.length === 0) {
      return;
    }

    let createdBy = '';
    if (resp[0].creatorUserId) {
      const userRepo = new UserRepository(this.logger, this.db);
      const user = await userRepo.byId(resp[0].creatorUserId);
      createdBy = user?.email || '';
    }

    const featureSubgraphs = await this.getFeatureSubgraphsByFeatureFlagId({
      namespaceId,
      featureFlagId: resp[0].id,
    });

    return {
      ...resp[0],
      labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: resp[0].createdAt.toISOString(),
      updatedAt: resp[0].updatedAt?.toISOString() || '',
      createdBy,
      creatorUserId: resp[0].creatorUserId || undefined,
      featureSubgraphs,
    };
  }

  public getFeatureFlagById({
    featureFlagId,
    namespaceId,
  }: {
    featureFlagId: string;
    namespaceId: string;
  }): Promise<FeatureFlagDTO | undefined> {
    return this.getFeatureFlag({
      namespaceId,
      conditions: [
        eq(featureFlags.organizationId, this.organizationId),
        eq(featureFlags.id, featureFlagId),
        eq(featureFlags.namespaceId, namespaceId),
      ],
    });
  }

  public getFeatureFlagByName({
    featureFlagName,
    namespaceId,
  }: {
    featureFlagName: string;
    namespaceId: string;
  }): Promise<FeatureFlagDTO | undefined> {
    return this.getFeatureFlag({
      namespaceId,
      conditions: [
        eq(featureFlags.organizationId, this.organizationId),
        eq(featureFlags.name, featureFlagName),
        eq(featureFlags.namespaceId, namespaceId),
      ],
    });
  }

  // returns the base subgraph based on the feature subgraph id
  public async getBaseSubgraphByFeatureSubgraphId({ id }: { id: string }): Promise<SubgraphDTO | undefined> {
    const baseSubgraph = await this.db
      .select({
        subgraphId: featureSubgraphsToBaseSubgraphs.baseSubgraphId,
      })
      .from(featureSubgraphsToBaseSubgraphs)
      .where(eq(featureSubgraphsToBaseSubgraphs.featureSubgraphId, id));

    if (baseSubgraph.length === 0) {
      return undefined;
    }

    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    return subgraphRepo.byId(baseSubgraph[0].subgraphId);
  }

  // returns all the feature subgraph ids associated with the base subgraph
  public getFeatureSubgraphsByBaseSubgraphId({ baseSubgraphId }: { baseSubgraphId: string }) {
    return this.db
      .select({
        id: featureSubgraphsToBaseSubgraphs.featureSubgraphId,
      })
      .from(featureSubgraphsToBaseSubgraphs)
      .where(eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, baseSubgraphId));
  }

  // deletes all the feature subgraphs associated with the base subgraph
  public deleteFeatureSubgraphsByBaseSubgraphId({
    subgraphId,
    namespaceId,
  }: {
    subgraphId: string;
    namespaceId: string;
  }) {
    return this.db.transaction(async (tx) => {
      const subgraphRepo = new SubgraphRepository(this.logger, tx, this.organizationId);
      const ffs = await tx
        .select({
          subgraphId: subgraphs.id,
          targetId: subgraphs.targetId,
        })
        .from(featureSubgraphsToBaseSubgraphs)
        .innerJoin(subgraphs, eq(subgraphs.id, featureSubgraphsToBaseSubgraphs.featureSubgraphId))
        .innerJoin(targets, eq(targets.id, subgraphs.targetId))
        .where(
          and(
            eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, subgraphId),
            eq(targets.namespaceId, namespaceId),
            eq(targets.organizationId, this.organizationId),
          ),
        );

      if (ffs.length === 0) {
        return;
      }

      for (const ff of ffs) {
        const ffSubgraph = await subgraphRepo.byId(ff.subgraphId);
        if (!ffSubgraph) {
          continue;
        }
        await tx.delete(targets).where(eq(targets.id, ffSubgraph.targetId));
      }
    });
  }

  // returns all the feature flags associated with the federated graph
  public async getFeatureFlagsByFederatedGraph({
    namespaceId,
    federatedGraph,
    rbac,
  }: {
    namespaceId: string;
    federatedGraph: FederatedGraphDTO;
    rbac?: RBACEvaluator;
  }): Promise<FeatureFlagDTO[]> {
    const fetaureFlags: FeatureFlagDTO[] = [];
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);

    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
      published: true,
      rbac,
    });

    const baseSubgraphNames = subgraphs.map((s) => s.name);

    for (const subgraph of subgraphs) {
      const ffs = await this.getFeatureFlagsByBaseSubgraphIdAndLabelMatchers({
        baseSubgraphId: subgraph.id,
        namespaceId,
        baseSubgraphNames,
        fedGraphLabelMatchers: federatedGraph.labelMatchers,
        excludeDisabled: false,
      });

      for (const ff of ffs) {
        const featureFlag = await this.getFeatureFlagById({
          featureFlagId: ff.id,
          namespaceId,
        });
        if (featureFlag && !fetaureFlags.some((f) => f.id === featureFlag.id)) {
          fetaureFlags.push(featureFlag);
        }
      }
    }
    return fetaureFlags;
  }

  // returns all the federated graphs associated with the feature flag
  public async getFederatedGraphsByFeatureFlag({
    featureFlagId,
    namespaceId,
    excludeDisabled,
    includeContracts,
  }: {
    featureFlagId: string;
    namespaceId: string;
    excludeDisabled: boolean;
    includeContracts?: boolean;
  }): Promise<FederatedGraphDTO[]> {
    const federatedGraphs: FederatedGraphDTO[] = [];
    const featureSubraphsOfFeatureFlag = await this.getFeatureSubgraphsByFeatureFlagId({
      featureFlagId,
      namespaceId,
    });
    if (featureSubraphsOfFeatureFlag.length === 0) {
      return [];
    }
    const baseSubgraphIds = featureSubraphsOfFeatureFlag.map((f) => f.baseSubgraphId);

    // fetches the federated graphs which contains all the base subgraphs of the feature subgraphs
    const federatedGraphIds = await this.db
      .select({
        federatedGraphId: subgraphsToFederatedGraph.federatedGraphId,
        count: sql<number>`cast(count(DISTINCT ${subgraphsToFederatedGraph.subgraphId}) as int)`,
      })
      .from(subgraphsToFederatedGraph)
      .where(inArray(subgraphsToFederatedGraph.subgraphId, baseSubgraphIds))
      .groupBy(subgraphsToFederatedGraph.federatedGraphId)
      .having(({ count }) => eq(count, baseSubgraphIds.length))
      .execute();

    for (const fg of federatedGraphIds) {
      const federatedGraphRepo = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
      const federatedGraph = await federatedGraphRepo.byId(fg.federatedGraphId);
      // Contracts will be handled through the source graph
      if (!federatedGraph || (federatedGraph.contract && !includeContracts)) {
        continue;
      }
      const matchedFeatureFlags = await this.getMatchedFeatureFlags({
        namespaceId,
        fedGraphLabelMatchers: federatedGraph.labelMatchers,
        excludeDisabled,
      });
      if (!matchedFeatureFlags.some((m) => m.id === featureFlagId)) {
        continue;
      }
      federatedGraphs.push(federatedGraph);
    }

    return federatedGraphs;
  }

  // returns all the feature flags which match the federated graph's label matchers
  public getMatchedFeatureFlags({
    namespaceId,
    fedGraphLabelMatchers,
    excludeDisabled,
  }: {
    namespaceId: string;
    fedGraphLabelMatchers: string[];
    excludeDisabled: boolean;
  }) {
    const groupedLabels: Label[][] = [];
    for (const lm of fedGraphLabelMatchers) {
      const labels = lm.split(',').map((l) => splitLabel(l));
      const normalizedLabels = normalizeLabels(labels);
      groupedLabels.push(normalizedLabels);
    }

    const conditions: SQL<unknown>[] = [];
    for (const labels of groupedLabels) {
      // At least one common label
      conditions.push(
        arrayOverlaps(
          featureFlags.labels,
          labels.map((l) => joinLabel(l)),
        ),
      );
    }

    // Only get feature flags that do not have any labels if the label matchers are empty.
    if (fedGraphLabelMatchers.length === 0) {
      conditions.push(eq(featureFlags.labels, []));
    }

    if (excludeDisabled) {
      conditions.push(eq(featureFlags.isEnabled, true));
    }

    return this.db
      .select({
        id: featureFlags.id,
      })
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.namespaceId, namespaceId),
          eq(featureFlags.organizationId, this.organizationId),
          ...conditions,
        ),
      )
      .execute();
  }

  // returns all the feature flags which contain feature subgraphs whose base subgraph is the same as the input base subgraph
  public async getFeatureFlagsByBaseSubgraphId({
    baseSubgraphId,
    namespaceId,
    excludeDisabled,
  }: {
    baseSubgraphId: string;
    namespaceId: string;
    excludeDisabled: boolean;
  }) {
    const conditions: SQL<unknown>[] = [
      eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, baseSubgraphId),
      eq(featureFlags.namespaceId, namespaceId),
      eq(featureFlags.organizationId, this.organizationId),
    ];

    if (excludeDisabled) {
      conditions.push(eq(featureFlags.isEnabled, true));
    }

    const enabledFeatureFlags = await this.db
      .select({
        id: featureFlags.id,
        name: featureFlags.name,
        labels: featureFlags.labels,
        isEnabled: featureFlags.isEnabled,
      })
      .from(featureFlags)
      .innerJoin(featureFlagToFeatureSubgraphs, eq(featureFlags.id, featureFlagToFeatureSubgraphs.featureFlagId))
      .innerJoin(
        featureSubgraphsToBaseSubgraphs,
        eq(featureFlagToFeatureSubgraphs.featureSubgraphId, featureSubgraphsToBaseSubgraphs.featureSubgraphId),
      )
      .where(and(...conditions))
      .execute();

    if (enabledFeatureFlags.length === 0) {
      return [];
    }

    return enabledFeatureFlags;
  }

  // returns all the feature subgraphs associated with the feature flag
  // input: feature flag id, namespace id
  public async getFeatureSubgraphsByFeatureFlagId({
    featureFlagId,
    namespaceId,
  }: {
    featureFlagId: string;
    namespaceId: string;
  }): Promise<FeatureSubgraphDTO[]> {
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const fgs = await this.db
      .select({
        name: targets.name,
        labels: targets.labels,
        createdBy: targets.createdBy,
        readme: targets.readme,
        id: subgraphs.id,
        routingUrl: subgraphs.routingUrl,
        subscriptionUrl: subgraphs.subscriptionUrl,
        subscriptionProtocol: subgraphs.subscriptionProtocol,
        websocketSubprotocol: subgraphs.websocketSubprotocol,
        targetId: subgraphs.targetId,
        namespaceId: namespaces.id,
        namespaceName: namespaces.name,
        schemaVersionId: subgraphs.schemaVersionId,
        isFeatureGraph: subgraphs.isFeatureSubgraph,
        baseSubgraphId: featureSubgraphsToBaseSubgraphs.baseSubgraphId,
        isEventDrivenGraph: subgraphs.isEventDrivenGraph,
        isFeatureSubgraph: subgraphs.isFeatureSubgraph,
        type: subgraphs.type,
      })
      .from(featureFlagToFeatureSubgraphs)
      .innerJoin(
        featureSubgraphsToBaseSubgraphs,
        eq(featureFlagToFeatureSubgraphs.featureSubgraphId, featureSubgraphsToBaseSubgraphs.featureSubgraphId),
      )
      .innerJoin(subgraphs, eq(subgraphs.id, featureSubgraphsToBaseSubgraphs.featureSubgraphId))
      .innerJoin(targets, eq(subgraphs.targetId, targets.id))
      .innerJoin(namespaces, eq(namespaces.id, targets.namespaceId))
      .where(
        and(
          eq(featureFlagToFeatureSubgraphs.featureFlagId, featureFlagId),
          eq(targets.namespaceId, namespaceId),
          eq(subgraphs.isFeatureSubgraph, true),
          eq(targets.organizationId, this.organizationId),
        ),
      )
      .execute();

    const featureGraphsByFlag = [];

    for (const fg of fgs) {
      let lastUpdatedAt = '';
      let schemaSDL = '';
      let schemaVersionId = '';
      let isV2Graph: boolean | undefined;
      let proto: ProtoSubgraph | undefined;

      if (fg.schemaVersionId !== null) {
        const sv = await this.db.query.schemaVersion.findFirst({
          where: eq(schemaVersion.id, fg.schemaVersionId),
        });
        lastUpdatedAt = sv?.createdAt?.toISOString() ?? '';
        schemaSDL = sv?.schemaSDL ?? '';
        schemaVersionId = sv?.id ?? '';
        isV2Graph = sv?.isV2Graph || undefined;
        if (fg.type === 'grpc_plugin' || fg.type === 'grpc_service') {
          const protobufSchemaVersion = await this.db.query.protobufSchemaVersions.findFirst({
            where: eq(schema.protobufSchemaVersions.schemaVersionId, fg.schemaVersionId),
          });

          if (!protobufSchemaVersion) {
            this.logger.warn(
              `Missing protobuf schema for ${fg.type} subgraph with schemaVersionId: ${fg.schemaVersionId}`,
            );
          }

          proto = {
            schema: protobufSchemaVersion?.protoSchema ?? '',
            mappings: protobufSchemaVersion?.protoMappings ?? '',
            lock: protobufSchemaVersion?.protoLock ?? '',
          };

          if (fg.type === 'grpc_plugin') {
            const pluginImageVersion = await this.db.query.pluginImageVersions.findFirst({
              where: eq(schema.pluginImageVersions.schemaVersionId, fg.schemaVersionId),
            });

            if (!pluginImageVersion) {
              this.logger.warn(
                `Missing plugin image version for ${fg.type} subgraph with schemaVersionId: ${fg.schemaVersionId}`,
              );
            }

            proto.pluginData = {
              platforms: pluginImageVersion?.platform ?? [],
              version: pluginImageVersion?.version ?? 'v1',
            };
          }
        }
      }

      const baseSubgraph = await subgraphRepo.byId(fg.baseSubgraphId);
      if (!baseSubgraph) {
        continue;
      }
      featureGraphsByFlag.push({
        ...fg,
        readme: fg.readme || undefined,
        subscriptionUrl: fg.subscriptionUrl ?? '',
        subscriptionProtocol: fg.subscriptionProtocol ?? 'ws',
        websocketSubprotocol: fg.websocketSubprotocol || undefined,
        creatorUserId: fg.createdBy || undefined,
        labels: fg.labels?.map?.((l) => splitLabel(l)) ?? [],
        namespace: fg.namespaceName,
        schemaVersionId,
        schemaSDL,
        lastUpdatedAt,
        baseSubgraphName: baseSubgraph.name,
        isV2Graph,
        proto,
      });
    }
    return featureGraphsByFlag;
  }

  // evaluates all the feature flags which have fgs whose base subgraph id and fed graph label matchers are passed as input and returns the feature flags that should be composed
  public async getFeatureFlagsByBaseSubgraphIdAndLabelMatchers({
    baseSubgraphId,
    namespaceId,
    baseSubgraphNames,
    fedGraphLabelMatchers,
    excludeDisabled,
  }: {
    baseSubgraphId: string;
    namespaceId: string;
    baseSubgraphNames: string[];
    fedGraphLabelMatchers: string[];
    excludeDisabled: boolean;
  }): Promise<FeatureFlagWithFeatureSubgraphs[]> {
    const featureFlagWithEnabledFeatureGraphs: FeatureFlagWithFeatureSubgraphs[] = [];
    const featureFlagsBySubgraphId = await this.getFeatureFlagsByBaseSubgraphId({
      baseSubgraphId,
      namespaceId,
      excludeDisabled,
    });

    // gets all the feature flags that match the label matchers
    const matchedFeatureFlags = await this.getMatchedFeatureFlags({
      namespaceId,
      fedGraphLabelMatchers,
      excludeDisabled,
    });

    for (const featureFlag of featureFlagsBySubgraphId) {
      const matched = matchedFeatureFlags.some((m) => m.id === featureFlag.id);
      if (!matched) {
        continue;
      }

      const featureSubgraphsByFlag = await this.getFeatureSubgraphsByFeatureFlagId({
        featureFlagId: featureFlag.id,
        namespaceId,
      });

      // if there are no feature subgraphs in the flag, then skip the flag
      if (featureSubgraphsByFlag.length === 0) {
        continue;
      }

      const baseSubgraphNamesOfFeatureFlags = featureSubgraphsByFlag.map((ff) => ff.baseSubgraphName);
      // check if all base subgraphs of feature flags are one of the base subgraphs of this composition
      const isSubset = baseSubgraphNamesOfFeatureFlags.every((name) => baseSubgraphNames.includes(name));
      if (!isSubset) {
        continue;
      }

      const filteredFeatureSubgraphs = featureSubgraphsByFlag.filter((ff) => ff.schemaVersionId !== '');

      featureFlagWithEnabledFeatureGraphs.push({
        id: featureFlag.id,
        name: featureFlag.name,
        featureSubgraphs: filteredFeatureSubgraphs,
      });
    }
    return featureFlagWithEnabledFeatureGraphs;
  }

  getFeatureFlagRelatedSubgraphsToCompose(
    featureFlagToComposeByFlagId: Map<string, FeatureFlagWithFeatureSubgraphs>,
    baseCompositionSubgraphs: Array<Subgraph>,
    subgraphs: Array<SubgraphDTO>,
    subgraphsToCompose: Array<SubgraphsToCompose>,
  ): Array<SubgraphsToCompose> {
    for (const flag of featureFlagToComposeByFlagId.values()) {
      let compositionSubgraphs = baseCompositionSubgraphs;
      let subgraphDTOs = subgraphs;
      if (flag.featureSubgraphs.length === 0) {
        continue;
      }
      for (const featureGraph of flag.featureSubgraphs) {
        compositionSubgraphs = compositionSubgraphs.filter((b) => b.name !== featureGraph.baseSubgraphName);
        subgraphDTOs = subgraphDTOs.filter((s) => s.name !== featureGraph.baseSubgraphName);
        compositionSubgraphs.push({
          name: featureGraph.name,
          url: featureGraph.routingUrl,
          definitions: parse(featureGraph.schemaSDL),
        });
        subgraphDTOs.push(featureGraph);
      }
      subgraphsToCompose.push({
        compositionSubgraphs,
        isFeatureFlagComposition: true,
        featureFlagName: flag.name,
        featureFlagId: flag.id,
        subgraphs: subgraphDTOs,
      });
    }
    return subgraphsToCompose;
  }

  /* Returns an array of subgraphs to compose into a federated graph
   * At least one of the constituent subgraphs are impacted by a change including any feature flags
   * */
  public async getSubgraphsToCompose({
    baseSubgraphs,
    fedGraphLabelMatchers,
    baseCompositionSubgraphs,
  }: {
    baseSubgraphs: SubgraphDTO[];
    fedGraphLabelMatchers: string[];
    baseCompositionSubgraphs: Subgraph[];
  }): Promise<Array<SubgraphsToCompose>> {
    // Always include the base graph
    const subgraphsToCompose: Array<SubgraphsToCompose> = [
      {
        compositionSubgraphs: baseCompositionSubgraphs,
        isFeatureFlagComposition: false,
        subgraphs: baseSubgraphs,
        featureFlagName: '',
        featureFlagId: '',
      },
    ];
    const featureFlagToComposeByFlagId = new Map<string, FeatureFlagWithFeatureSubgraphs>();
    for (const subgraph of baseSubgraphs) {
      // fetching all the ffs which have fgs whose base subgraph id is the passed as input
      const enabledFeatureFlags = await this.getFeatureFlagsByBaseSubgraphIdAndLabelMatchers({
        baseSubgraphId: subgraph.id,
        namespaceId: subgraph.namespaceId,
        fedGraphLabelMatchers,
        baseSubgraphNames: baseCompositionSubgraphs.map((baseSubgraph) => baseSubgraph.name),
        excludeDisabled: true,
      });
      for (const flag of enabledFeatureFlags) {
        if (featureFlagToComposeByFlagId.has(flag.id)) {
          continue;
        }
        featureFlagToComposeByFlagId.set(flag.id, flag);
      }
    }
    return this.getFeatureFlagRelatedSubgraphsToCompose(
      featureFlagToComposeByFlagId,
      baseCompositionSubgraphs,
      baseSubgraphs,
      subgraphsToCompose,
    );
  }

  // return all the feature flag compositions associated with the base schema version
  // input: base schema version id, namespace id
  public async getFeatureFlagCompositionsByBaseSchemaVersion({
    baseSchemaVersionId,
    namespaceId,
  }: {
    baseSchemaVersionId: string;
    namespaceId: string;
  }) {
    const featureFlagCompositions: FeatureFlagCompositionDTO[] = [];
    const compositions = await this.db
      .select({
        id: graphCompositions.id,
        featureFlagId: federatedGraphsToFeatureFlagSchemaVersions.featureFlagId,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        compositionWarnings: graphCompositions.compositionWarnings,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        createdByEmail: graphCompositions.createdByEmail,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .innerJoin(
        federatedGraphsToFeatureFlagSchemaVersions,
        eq(federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId, schemaVersion.id),
      )
      .leftJoin(users, eq(users.id, graphCompositions.createdById))
      .where(eq(federatedGraphsToFeatureFlagSchemaVersions.baseCompositionSchemaVersionId, baseSchemaVersionId))
      .execute();

    for (const composition of compositions) {
      let featureFlagName = '';
      if (composition.featureFlagId !== null) {
        const featureFlag = await this.getFeatureFlagById({
          featureFlagId: composition.featureFlagId,
          namespaceId,
        });
        featureFlagName = featureFlag?.name || '';
      }

      featureFlagCompositions.push({
        ...composition,
        featureFlagName,
        createdAt: composition.createdAt.toISOString(),
        compositionErrors: composition.compositionErrors || undefined,
        compositionWarnings: composition.compositionWarnings || undefined,
        createdBy: composition.createdBy || composition.createdByEmail || undefined,
        routerConfigSignature: composition.routerConfigSignature || undefined,
        admissionError: composition.admissionError || undefined,
        deploymentError: composition.deploymentError || undefined,
        isComposable: composition.isComposable || false,
      });
    }
    return featureFlagCompositions;
  }

  // return all the feature flag schema versions associated with the base schema version
  // input: base schema version id
  public async getFeatureFlagSchemaVersionsByBaseSchemaVersion({
    baseSchemaVersionId,
  }: {
    baseSchemaVersionId: string;
  }) {
    const ffSchemaVersions = await this.db
      .select({
        id: federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
        featureFlagId: federatedGraphsToFeatureFlagSchemaVersions.featureFlagId,
      })
      .from(federatedGraphsToFeatureFlagSchemaVersions)
      .where(and(eq(federatedGraphsToFeatureFlagSchemaVersions.baseCompositionSchemaVersionId, baseSchemaVersionId)))
      .execute();

    if (ffSchemaVersions.length === 0) {
      return;
    }

    return ffSchemaVersions;
  }

  // return a particular feature flag schema version which is associated with the base schema version and feature flag id
  // input: base schema version id and feature flag id
  public async getFeatureFlagSchemaVersionByBaseSchemaVersion({
    baseSchemaVersionId,
    featureFlagId,
  }: {
    baseSchemaVersionId: string;
    featureFlagId: string;
  }) {
    const schemaVersion = await this.db
      .select({
        id: federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
      })
      .from(federatedGraphsToFeatureFlagSchemaVersions)
      .where(
        and(
          eq(federatedGraphsToFeatureFlagSchemaVersions.baseCompositionSchemaVersionId, baseSchemaVersionId),
          eq(federatedGraphsToFeatureFlagSchemaVersions.featureFlagId, featureFlagId),
        ),
      )
      .execute();

    if (schemaVersion.length === 0) {
      return;
    }

    const federatedGraphRepo = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
    const ffSchemaVersion = await federatedGraphRepo.getSchemaVersionById({ schemaVersionId: schemaVersion[0].id });

    return ffSchemaVersion;
  }

  public async delete(featureFlagId: string) {
    await this.db
      .delete(featureFlags)
      .where(and(eq(featureFlags.id, featureFlagId), eq(featureFlags.organizationId, this.organizationId)))
      .execute();
  }

  public async count(organizationId: string) {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.organizationId, organizationId))
      .execute();

    return result[0]?.count || 0;
  }

  public async checkConstituentFeatureSubgraphs({
    featureSubgraphNames,
    namespace,
  }: {
    featureSubgraphNames: Array<string>;
    namespace: string;
  }): Promise<CheckConstituentFeatureSubgraphsResult> {
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const errorMessages: Array<string> = [];
    const baseSubgraphIds = new Set<string>();
    // Set to be 100% confident there are no duplicate IDs
    const featureSubgraphIds = new Set<string>();
    let count = 1;
    for (const featureSubgraphName of featureSubgraphNames) {
      const featureSubgraph = await subgraphRepo.byName(featureSubgraphName, namespace);
      if (!featureSubgraph) {
        errorMessages.push(`${count++}. The feature subgraph "${featureSubgraphName}" was not found.`);
        continue;
      } else if (!featureSubgraph.isFeatureSubgraph) {
        errorMessages.push(`${count++}. The subgraph "${featureSubgraphName}" is not a feature subgraph.`);
        continue;
      }
      const baseSubgraph = await this.getBaseSubgraphByFeatureSubgraphId({ id: featureSubgraph.id });
      if (!baseSubgraph) {
        errorMessages.push(
          `${count++}. The base subgraph of the feature subgraph "${featureSubgraphName}" was not found.`,
        );
        continue;
      }
      if (baseSubgraphIds.has(baseSubgraph.id)) {
        errorMessages.push(
          `${count++}. Feature subgraphs with the same base subgraph cannot compose the same feature flag.`,
        );
        break;
      } else {
        baseSubgraphIds.add(baseSubgraph.id);
      }
      featureSubgraphIds.add(featureSubgraph.id);
    }
    return {
      errorMessages,
      featureSubgraphIds: [...featureSubgraphIds],
    };
  }
}
