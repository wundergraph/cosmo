import { Subgraph } from '@wundergraph/composition';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { and, eq, inArray, SQL, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { parse } from 'graphql';
import * as schema from '../../db/schema.js';
import {
  featureFlags,
  featureFlagToFeatureSubgraphs,
  featureSubgraphsToBaseSubgraphs,
  namespaces,
  schemaVersion,
  subgraphs,
  subgraphsToFederatedGraph,
  targets,
} from '../../db/schema.js';
import { FeatureFlagDTO, FederatedGraphDTO, Label, SubgraphDTO } from '../../types/index.js';
import { normalizeLabels } from '../util.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

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
  }: {
    name: string;
    namespaceId: string;
    labels: Label[];
    createdBy: string;
    featureSubgraphIds: string[];
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
          isEnabled: true,
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
        labels: featureFlags.labels,
        createdBy: featureFlags.createdBy,
        isEnabled: featureFlags.isEnabled,
        organizationId: featureFlags.organizationId,
        createdAt: featureFlags.createdAt,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
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
    return {
      ...resp[0],
      labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: resp[0].createdAt.toISOString(),
      updatedAt: resp[0].updatedAt?.toISOString() || undefined,
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
        namespaceId: featureFlags.namespaceId,
        labels: featureFlags.labels,
        createdBy: featureFlags.createdBy,
        isEnabled: featureFlags.isEnabled,
        organizationId: featureFlags.organizationId,
        createdAt: featureFlags.createdAt,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
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
    return {
      ...resp[0],
      labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
      createdAt: resp[0].createdAt.toISOString(),
      updatedAt: resp[0].updatedAt?.toISOString() || undefined,
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
    const baseSubgraphDTO = await subgraphRepo.byId(baseSubgraph[0].subgraphId);
    return baseSubgraphDTO;
  }

  public async getFeatureSubgraphsByBaseSubgraphId({ baseSubgraphId }: { baseSubgraphId: string }) {
    const ffs = await this.db
      .select({
        id: featureSubgraphsToBaseSubgraphs.featureSubgraphId,
      })
      .from(featureSubgraphsToBaseSubgraphs)
      .where(eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, baseSubgraphId));

    return ffs;
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
        labelMatchers: federatedGraph.labelMatchers,
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
    labelMatchers,
    excludeDisabled,
  }: {
    namespaceId: string;
    labelMatchers: string[];
    excludeDisabled: boolean;
  }) {
    const groupedLabels: Label[][] = [];
    for (const lm of labelMatchers) {
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

    // Only get subgraphs that do not have any labels if the label matchers are empty.
    if (labelMatchers.length === 0) {
      conditions.push(eq(featureFlags.labels, []));
    }

    const matchedFeatureFlags = await this.db
      .select({
        id: featureFlags.id,
      })
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.namespaceId, namespaceId),
          eq(featureFlags.isEnabled, excludeDisabled),
          eq(featureFlags.organizationId, this.organizationId),
          ...conditions,
        ),
      )
      .execute();

    return matchedFeatureFlags;
  }

  public async getFeatureGraphsBySubgraphIdAndLabels({
    subgraphId,
    namespaceId,
    labelMatchers,
  }: {
    subgraphId: string;
    namespaceId: string;
    labelMatchers: string[];
  }): Promise<SubgraphDTO[]> {
    const resp = await this.db
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
        isEventDrivenGraph: subgraphs.isEventDrivenGraph,
      })
      .from(featureSubgraphsToBaseSubgraphs)
      .innerJoin(subgraphs, eq(subgraphs.id, featureSubgraphsToBaseSubgraphs.featureSubgraphId))
      .innerJoin(targets, eq(targets.id, subgraphs.targetId))
      .innerJoin(namespaces, eq(namespaces.id, targets.namespaceId))
      .where(and(eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, subgraphId), eq(targets.namespaceId, namespaceId)))
      .execute();

    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const matchedFeatureGraphs = await subgraphRepo.byGraphLabelMatchers({
      namespaceId,
      labelMatchers,
      isFeatureGraph: true,
    });

    const featureGraphs: SubgraphDTO[] = [];
    for (const ff of resp) {
      if (ff.schemaVersionId === null) {
        continue;
      }

      // label matching
      const matched = matchedFeatureGraphs.some((m) => m.id === ff.id);
      if (!matched) {
        continue;
      }

      const sv = await this.db.query.schemaVersion.findFirst({
        where: eq(schemaVersion.id, ff.schemaVersionId),
      });
      if (!sv || !sv.schemaSDL) {
        continue;
      }

      featureGraphs.push({
        ...ff,
        readme: ff.readme || undefined,
        subscriptionUrl: ff.subscriptionUrl ?? '',
        subscriptionProtocol: ff.subscriptionProtocol ?? 'ws',
        websocketSubprotocol: ff.websocketSubprotocol || undefined,
        creatorUserId: ff.createdBy || undefined,
        schemaSDL: sv.schemaSDL,
        lastUpdatedAt: sv.createdAt.toISOString(),
        labels: ff.labels?.map?.((l) => splitLabel(l)) ?? [],
        namespace: ff.namespaceName,
        schemaVersionId: sv.id,
      });
    }
    return featureGraphs;
  }

  public async getEnabledFeatureFlagsBySubgraphId({
    subgraphId,
    namespaceId,
  }: {
    subgraphId: string;
    namespaceId: string;
  }) {
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
      .where(
        and(
          eq(featureSubgraphsToBaseSubgraphs.baseSubgraphId, subgraphId),
          eq(featureFlags.isEnabled, true),
          eq(featureFlags.namespaceId, namespaceId),
        ),
      )
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

  // evaluates all the ffs which have fgs whose base subgraph id is the passed as input and returns the ffs that should be composed
  public async getEnabledFeatureFlagsBySubgraphIdAndLabels({
    subgraphId,
    namespaceId,
    baseSubgraphNames,
    labelMatchers,
  }: {
    subgraphId: string;
    namespaceId: string;
    baseSubgraphNames: string[];
    labelMatchers: string[];
  }): Promise<FeatureFlagWithFeatureSubgraphs[]> {
    const featureFlagWithEnabledFeatureGraphs: FeatureFlagWithFeatureSubgraphs[] = [];
    const enabledFeatureFlags = await this.getEnabledFeatureFlagsBySubgraphId({
      subgraphId,
      namespaceId,
    });

    // gets all the ffs that match the label matchers
    const matchedFeatureFlags = await this.getMatchedFeatureFlags({
      namespaceId,
      labelMatchers,
      excludeDisabled: true,
    });

    for (const enabledFeatureFlag of enabledFeatureFlags) {
      const matched = matchedFeatureFlags.some((m) => m.id === enabledFeatureFlag.id);
      if (!matched) {
        continue;
      }

      const featureSubgraphsByFlag = await this.getFeatureGraphsByFlagId({
        featureFlagId: enabledFeatureFlag.id,
        namespaceId,
      });

      // if there are no enabled feature graphs in the flag, then skip the flag
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
        id: enabledFeatureFlag.id,
        name: enabledFeatureFlag.name,
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
        subgraphs: subgraphDTOs,
      });
    }
    return subgraphsToCompose;
  }

  /* Returns an array of subgraphs to compose into a federated graph
   * At least one of the constituent subgraphs are impacted by a change including any feature flags
   * */
  public async getSubgraphsToCompose({
    subgraphs,
    fedGraphLabelMatchers,
    baseCompositionSubgraphs,
  }: {
    subgraphs: SubgraphDTO[];
    fedGraphLabelMatchers: string[];
    baseCompositionSubgraphs: Subgraph[];
  }): Promise<Array<SubgraphsToCompose>> {
    // Always include the base graph
    const subgraphsToCompose: Array<SubgraphsToCompose> = [
      {
        compositionSubgraphs: baseCompositionSubgraphs,
        isFeatureFlagComposition: false,
        subgraphs,
        featureFlagName: '',
      },
    ];
    const featureFlagToComposeByFlagId = new Map<string, FeatureFlagWithFeatureSubgraphs>();
    for (const subgraph of subgraphs) {
      // fetching all the ffs which have fgs whose base subgraph id is the passed as input
      const enabledFeatureFlags = await this.getEnabledFeatureFlagsBySubgraphIdAndLabels({
        subgraphId: subgraph.id,
        namespaceId: subgraph.namespaceId,
        labelMatchers: fedGraphLabelMatchers,
        baseSubgraphNames: baseCompositionSubgraphs.map((baseSubgraph) => baseSubgraph.name),
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
      subgraphs,
      subgraphsToCompose,
    );
  }

  public async delete(featureFlagId: string) {
    await this.db.delete(featureFlags).where(eq(featureFlags.id, featureFlagId)).execute();
  }

  public async count(organizationId: string) {
    const result = await this.db
      .select({
        count: sql<number>`cast(count(${featureFlags.id}) as int)`,
      })
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.organizationId, organizationId))
      .execute();

    return result[0]?.count || 0;
  }
}
