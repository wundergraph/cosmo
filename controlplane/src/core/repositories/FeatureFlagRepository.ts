import { Subgraph } from '@wundergraph/composition';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { SQL, and, count, eq, inArray, like, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
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
import { FeatureFlagCompositionDTO, FeatureFlagDTO, FederatedGraphDTO, Label, SubgraphDTO } from '../../types/index.js';
import { normalizeLabels } from '../util.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { UserRepository } from './UserRepository.js';

export interface FeatureFlagWithFeatureSubgraphs {
  id: string;
  name: string;
  featureSubgraphs: (SubgraphDTO & {
    baseSubgraphName: string;
    baseSubgraphId: string;
  })[];
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
}

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
  }: {
    featureFlag: FeatureFlagDTO;
    labels: Label[];
    featureSubgraphIds: string[];
  }) {
    const uniqueLabels = normalizeLabels(labels);
    return this.db.transaction(async (tx) => {
      await tx
        .update(featureFlags)
        .set({
          labels: uniqueLabels.map((ul) => joinLabel(ul)),
        })
        .where(eq(featureFlags.id, featureFlag.id))
        .execute();

      if (featureSubgraphIds.length > 0) {
        // delete all the feature flags of the group
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

    const resp = await this.db
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
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .execute();

    return resp.map((r) => ({
      ...r,
      labels: r.labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: resp[0].updatedAt?.toISOString() || '',
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

  public async getFeatureFlagById({
    featureFlagId,
    namespaceId,
  }: {
    featureFlagId: string;
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
      .where(
        and(
          eq(featureFlags.organizationId, this.organizationId),
          eq(featureFlags.id, featureFlagId),
          eq(featureFlags.namespaceId, namespaceId),
        ),
      )
      .execute();
    if (resp.length === 0) {
      return;
    }

    let createdBy = '';
    if (resp[0].creatorUserId) {
      const userRepo = new UserRepository(this.db);
      const user = await userRepo.byId(resp[0].creatorUserId);
      createdBy = user?.email || '';
    }

    return {
      ...resp[0],
      labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: resp[0].createdAt.toISOString(),
      updatedAt: resp[0].updatedAt?.toISOString() || '',
      createdBy,
      creatorUserId: resp[0].creatorUserId || undefined,
    };
  }

  public async getFeatureFlagByName({
    featureFlagName,
    namespaceId,
  }: {
    featureFlagName: string;
    namespaceId: string;
  }): Promise<FeatureFlagDTO | undefined> {
    const resp = await this.db
      .select({
        id: featureFlags.id,
        name: featureFlags.name,
        namespace: namespaces.name,
        namespaceId: featureFlags.namespaceId,
        labels: featureFlags.labels,
        creatorUserId: featureFlags.createdBy,
        isEnabled: featureFlags.isEnabled,
        organizationId: featureFlags.organizationId,
        createdAt: featureFlags.createdAt,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
      .innerJoin(namespaces, eq(namespaces.id, featureFlags.namespaceId))
      .where(
        and(
          eq(featureFlags.organizationId, this.organizationId),
          eq(featureFlags.name, featureFlagName),
          eq(featureFlags.namespaceId, namespaceId),
        ),
      )
      .execute();
    if (resp.length === 0) {
      return;
    }

    let createdBy = '';
    if (resp[0].creatorUserId) {
      const userRepo = new UserRepository(this.db);
      const user = await userRepo.byId(resp[0].creatorUserId);
      createdBy = user?.email || '';
    }

    return {
      ...resp[0],
      labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: resp[0].createdAt.toISOString(),
      updatedAt: resp[0].updatedAt?.toISOString() || '',
      createdBy,
      creatorUserId: resp[0].creatorUserId || undefined,
    };
  }

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

  public getFeatureSubgraphsByBaseSubgraphId({ baseSubgraphId }: { baseSubgraphId: string }) {
    return this.db
      .select({
        id: featureSubgraphsToBaseSubgraphs.featureSubgraphId,
      })
      .from(featureSubgraphsToBaseSubgraphs)
      .where(eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, baseSubgraphId));
  }

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
          and(eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, subgraphId), eq(targets.namespaceId, namespaceId)),
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

  public async getFeatureFlagsByFederatedGraph({
    namespaceId,
    federatedGraph,
  }: {
    namespaceId: string;
    federatedGraph: FederatedGraphDTO;
  }): Promise<FeatureFlagDTO[]> {
    const fetaureFlags: FeatureFlagDTO[] = [];
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);

    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
      published: true,
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

  public async getFederatedGraphsByFeatureFlag({
    featureFlagId,
    namespaceId,
    excludeDisabled,
  }: {
    featureFlagId: string;
    namespaceId: string;
    excludeDisabled: boolean;
  }): Promise<FederatedGraphDTO[]> {
    const federatedGraphs: FederatedGraphDTO[] = [];
    const featureGraphsOfFeatureFlag = await this.getFeatureGraphsByFlagId({ featureFlagId, namespaceId });
    if (featureGraphsOfFeatureFlag.length === 0) {
      return [];
    }
    const baseSubgraphIds = featureGraphsOfFeatureFlag.map((f) => f.baseSubgraphId);

    // fetches the federated graphs which contains all the base subgraphs of the ffg
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
      if (!federatedGraph || federatedGraph.contract) {
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

  public async getMatchedFeatureFlags({
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
      const labelsSQL = labels.map((l) => `"${joinLabel(l)}"`).join(', ');
      // At least one common label
      conditions.push(sql.raw(`labels && '{${labelsSQL}}'`));
    }

    // Only get feature flags that do not have any labels if the label matchers are empty.
    if (fedGraphLabelMatchers.length === 0) {
      conditions.push(eq(featureFlags.labels, []));
    }

    if (excludeDisabled) {
      conditions.push(eq(featureFlags.isEnabled, true));
    }

    const matchedFeatureFlags = await this.db
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

    return matchedFeatureFlags;
  }

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

  public async getFeatureGraphsByFlagId({
    featureFlagId,
    namespaceId,
  }: {
    featureFlagId: string;
    namespaceId: string;
  }): Promise<
    (SubgraphDTO & {
      baseSubgraphName: string;
      baseSubgraphId: string;
    })[]
  > {
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
      })
      .from(featureFlagToFeatureSubgraphs)
      .innerJoin(
        featureSubgraphsToBaseSubgraphs,
        eq(featureFlagToFeatureSubgraphs.featureSubgraphId, featureSubgraphsToBaseSubgraphs.featureSubgraphId),
      )
      .innerJoin(subgraphs, eq(subgraphs.id, featureSubgraphsToBaseSubgraphs.featureSubgraphId))
      .innerJoin(targets, eq(subgraphs.targetId, targets.id))
      .innerJoin(namespaces, eq(namespaces.id, targets.namespaceId))
      .where(and(eq(featureFlagToFeatureSubgraphs.featureFlagId, featureFlagId), eq(targets.namespaceId, namespaceId)))
      .execute();

    const featureGraphsByFlag = [];

    for (const fg of fgs) {
      if (fg.schemaVersionId === null) {
        continue;
      }

      const sv = await this.db.query.schemaVersion.findFirst({
        where: eq(schemaVersion.id, fg.schemaVersionId),
      });
      if (!sv || !sv.schemaSDL) {
        continue;
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
        schemaSDL: sv.schemaSDL,
        lastUpdatedAt: sv.createdAt.toISOString(),
        labels: fg.labels?.map?.((l) => splitLabel(l)) ?? [],
        namespace: fg.namespaceName,
        schemaVersionId: sv.id,
        baseSubgraphName: baseSubgraph.name,
      });
    }
    return featureGraphsByFlag;
  }

  // evaluates all the ffs which have fgs whose base subgraph id and fed graph label matchers are passed as input and returns the ffs that should be composed
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

    // gets all the ffs that match the label matchers
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

      const featureSubgraphsByFlag = await this.getFeatureGraphsByFlagId({
        featureFlagId: featureFlag.id,
        namespaceId,
      });

      // if there are no feature graphs in the flag, then skip the flag
      if (featureSubgraphsByFlag.length === 0) {
        continue;
      }

      const baseSubgraphNamesOfFeatureFlags = featureSubgraphsByFlag.map((ff) => ff.baseSubgraphName);
      // check if all base subgraphs of feature flags are one of the base subgraphs of this composition
      const isSubset = baseSubgraphNamesOfFeatureFlags.every((name) => baseSubgraphNames.includes(name));
      if (!isSubset) {
        continue;
      }

      featureFlagWithEnabledFeatureGraphs.push({
        id: featureFlag.id,
        name: featureFlag.name,
        featureSubgraphs: featureSubgraphsByFlag,
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
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
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
      .leftJoin(users, eq(users.id, graphCompositions.createdBy))
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
        createdBy: composition.createdBy || undefined,
        routerConfigSignature: composition.routerConfigSignature || undefined,
        admissionError: composition.admissionError || undefined,
        deploymentError: composition.deploymentError || undefined,
        isComposable: composition.isComposable || false,
      });
    }
    return featureFlagCompositions;
  }

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

  public async getFeatureFlagSchemaVersionByBaseSchemaVersionAndFfId({
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

  public async getFeatureSubgraphsByFeatureFlag({
    featureFlagId,
    namespaceId,
  }: {
    namespaceId: string;
    featureFlagId: string;
  }) {
    const featureSubgraphsByFf = await this.db
      .select({
        id: featureFlagToFeatureSubgraphs.featureSubgraphId,
      })
      .from(featureFlagToFeatureSubgraphs)
      .innerJoin(subgraphs, eq(subgraphs.id, featureFlagToFeatureSubgraphs.featureSubgraphId))
      .innerJoin(targets, eq(targets.id, subgraphs.targetId))
      .where(and(eq(targets.namespaceId, namespaceId), eq(featureFlagToFeatureSubgraphs.featureFlagId, featureFlagId)))
      .execute();

    if (featureSubgraphsByFf.length === 0) {
      return [];
    }

    const featureSubgraphs: SubgraphDTO[] = [];

    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    for (const fs of featureSubgraphsByFf) {
      const subgraph = await subgraphRepo.byId(fs.id);
      if (!subgraph) {
        continue;
      }
      featureSubgraphs.push(subgraph);
    }

    return featureSubgraphs;
  }

  public async delete(featureFlagId: string) {
    await this.db.delete(featureFlags).where(eq(featureFlags.id, featureFlagId)).execute();
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
}
