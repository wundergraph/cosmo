import { JsonValue } from '@bufbuild/protobuf';
import { Subgraph } from '@wundergraph/composition';
import { FeatureFlagRouterExecutionConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { ffRouterConfigFromJson, joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { and, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { parse } from 'graphql';
import * as schema from '../../db/schema.js';
import {
  featureFlagGroupToFeatureFlags,
  featureFlagGroups,
  featureFlagsToSubgraph,
  graphCompositions,
  namespaces,
  schemaVersion,
  subgraphs,
  targets,
} from '../../db/schema.js';
import { FeatureFlagGroupDTO, Label, SubgraphDTO } from '../../types/index.js';
import { normalizeLabels } from '../util.js';
import { SubgraphRepository } from './SubgraphRepository.js';

export interface FeatureFlagGroupWithEnabledFeatureFlags {
  id: string;
  name: string;
  enabledFeatureFlags: (SubgraphDTO & {
    baseSubgraphName: string;
    baseSubgraphId: string;
    isEnabled: boolean;
  })[];
}

export interface CompositionPossibilities {
  compositionSubgraphs: Subgraph[];
  subgraphs: SubgraphDTO[];
  isFeatureFlagComposition: boolean;
  // can be the name of ff or ffg
  featureFlagName?: string;
}

export class FeatureFlagRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async enableFeatureFlag({ featureFlagId, isEnabled }: { featureFlagId: string; isEnabled: boolean }) {
    await this.db
      .update(featureFlagsToSubgraph)
      .set({ isEnabled })
      .where(eq(featureFlagsToSubgraph.featureFlagId, featureFlagId))
      .execute();
  }

  public createFeatureFlagGroup({
    featureFlagGroupName,
    namespaceId,
    labels,
    createdBy,
    featureFlagIds,
  }: {
    featureFlagGroupName: string;
    namespaceId: string;
    labels: Label[];
    createdBy: string;
    featureFlagIds: string[];
  }) {
    const uniqueLabels = normalizeLabels(labels);
    return this.db.transaction(async (tx) => {
      const featureFlagGroup = await tx
        .insert(featureFlagGroups)
        .values({
          name: featureFlagGroupName,
          organizationId: this.organizationId,
          namespaceId,
          createdBy,
          isEnabled: true,
          labels: uniqueLabels.map((ul) => joinLabel(ul)),
        })
        .returning()
        .execute();
      if (featureFlagIds.length > 0) {
        await tx.insert(featureFlagGroupToFeatureFlags).values(
          featureFlagIds.map((featureFlagId) => ({
            featureFlagGroupId: featureFlagGroup[0].id,
            featureFlagId,
          })),
        );
      }
    });
  }

  public async getFeatureFlagGroupById({
    featureFlagGroupId,
    namespaceId,
  }: {
    featureFlagGroupId: string;
    namespaceId: string;
  }): Promise<FeatureFlagGroupDTO | undefined> {
    const resp = await this.db
      .select({
        id: featureFlagGroups.id,
        name: featureFlagGroups.name,
        namespaceId: featureFlagGroups.namespaceId,
        labels: featureFlagGroups.labels,
        createdBy: featureFlagGroups.createdBy,
        isEnabled: featureFlagGroups.isEnabled,
        organizationId: featureFlagGroups.organizationId,
        createdAt: featureFlagGroups.createdAt,
        updatedAt: featureFlagGroups.updatedAt,
      })
      .from(featureFlagGroups)
      .where(
        and(
          eq(featureFlagGroups.organizationId, this.organizationId),
          eq(featureFlagGroups.id, featureFlagGroupId),
          eq(featureFlagGroups.namespaceId, namespaceId),
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

  public async getFeatureFlagGroupByName({
    featureFlagGroupName,
    namespaceId,
  }: {
    featureFlagGroupName: string;
    namespaceId: string;
  }): Promise<FeatureFlagGroupDTO | undefined> {
    const resp = await this.db
      .select({
        id: featureFlagGroups.id,
        name: featureFlagGroups.name,
        namespaceId: featureFlagGroups.namespaceId,
        labels: featureFlagGroups.labels,
        createdBy: featureFlagGroups.createdBy,
        isEnabled: featureFlagGroups.isEnabled,
        organizationId: featureFlagGroups.organizationId,
        createdAt: featureFlagGroups.createdAt,
        updatedAt: featureFlagGroups.updatedAt,
      })
      .from(featureFlagGroups)
      .where(
        and(
          eq(featureFlagGroups.organizationId, this.organizationId),
          eq(featureFlagGroups.name, featureFlagGroupName),
          eq(featureFlagGroups.namespaceId, namespaceId),
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

  public async enableFeatureFlagGroup({
    featureFlagGroupId,
    namespaceId,
    isEnabled,
  }: {
    featureFlagGroupId: string;
    namespaceId: string;
    isEnabled: boolean;
  }) {
    await this.db
      .update(featureFlagGroups)
      .set({ isEnabled, updatedAt: new Date() })
      .where(
        and(
          eq(featureFlagGroups.id, featureFlagGroupId),
          eq(featureFlagGroups.organizationId, this.organizationId),
          eq(featureFlagGroups.namespaceId, namespaceId),
        ),
      )
      .execute();
  }

  public async getEnabledFeatureFlagsBySubgraphIdAndLabels({
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
        isFeatureFlag: subgraphs.isFeatureFlag,
      })
      .from(featureFlagsToSubgraph)
      .innerJoin(subgraphs, eq(subgraphs.id, featureFlagsToSubgraph.featureFlagId))
      .innerJoin(targets, eq(targets.id, subgraphs.targetId))
      .innerJoin(namespaces, eq(namespaces.id, targets.namespaceId))
      .where(
        and(
          eq(featureFlagsToSubgraph.baseSubgraphId, subgraphId),
          eq(featureFlagsToSubgraph.isEnabled, true),
          eq(targets.namespaceId, namespaceId),
        ),
      )
      .execute();

    const enabledFeatureFlags: SubgraphDTO[] = [];
    for (const ff of resp) {
      if (ff.schemaVersionId === null) {
        continue;
      }
      // TODO perform label matching

      const sv = await this.db.query.schemaVersion.findFirst({
        where: eq(schemaVersion.id, ff.schemaVersionId),
      });
      if (!sv || !sv.schemaSDL) {
        continue;
      }

      enabledFeatureFlags.push({
        ...ff,
        readme: ff.readme || undefined,
        subscriptionUrl: ff.subscriptionUrl ?? '',
        subscriptionProtocol: ff.subscriptionProtocol ?? 'ws',
        websocketSubprotocol: ff.websocketSubprotocol || undefined,
        creatorUserId: ff.createdBy || undefined,
        schemaSDL: sv.schemaSDL,
        lastUpdatedAt: sv.createdAt.toISOString(),
        labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
        namespace: ff.namespaceName,
        schemaVersionId: sv.id,
      });
    }
    return enabledFeatureFlags;
  }

  public async getEnabledFeatureFlagGroupsBySubgraphId({
    subgraphId,
    namespaceId,
  }: {
    subgraphId: string;
    namespaceId: string;
  }) {
    const enabledFeatureFlagGroups = await this.db
      .select({
        id: featureFlagGroups.id,
        name: featureFlagGroups.name,
        labels: featureFlagGroups.labels,
        isEnabled: featureFlagGroups.isEnabled,
      })
      .from(featureFlagGroups)
      .innerJoin(
        featureFlagGroupToFeatureFlags,
        eq(featureFlagGroups.id, featureFlagGroupToFeatureFlags.featureFlagGroupId),
      )
      .innerJoin(
        featureFlagsToSubgraph,
        eq(featureFlagGroupToFeatureFlags.featureFlagId, featureFlagsToSubgraph.featureFlagId),
      )
      .where(
        and(
          eq(featureFlagsToSubgraph.baseSubgraphId, subgraphId),
          eq(featureFlagGroups.isEnabled, true),
          eq(featureFlagGroups.namespaceId, namespaceId),
        ),
      )
      .execute();

    if (enabledFeatureFlagGroups.length === 0) {
      return [];
    }

    return enabledFeatureFlagGroups;
  }

  public async getEnabledFeatureFlagsByGroupId({ featureFlagGroupId }: { featureFlagGroupId: string }): Promise<
    (SubgraphDTO & {
      baseSubgraphName: string;
      baseSubgraphId: string;
      isEnabled: boolean;
    })[]
  > {
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
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
        isFeatureFlag: subgraphs.isFeatureFlag,
        isEnabled: featureFlagsToSubgraph.isEnabled,
        baseSubgraphId: featureFlagsToSubgraph.baseSubgraphId,
      })
      .from(featureFlagGroupToFeatureFlags)
      .innerJoin(
        featureFlagsToSubgraph,
        eq(featureFlagGroupToFeatureFlags.featureFlagId, featureFlagsToSubgraph.featureFlagId),
      )
      .innerJoin(subgraphs, eq(subgraphs.id, featureFlagsToSubgraph.featureFlagId))
      .innerJoin(targets, eq(subgraphs.targetId, targets.id))
      .innerJoin(namespaces, eq(namespaces.id, targets.namespaceId))
      .where(
        and(
          eq(featureFlagGroupToFeatureFlags.featureFlagGroupId, featureFlagGroupId),
          eq(featureFlagsToSubgraph.isEnabled, true),
        ),
      )
      .execute();

    const enabledFetaureFlagsByGroup = [];

    for (const ff of resp) {
      if (ff.schemaVersionId === null) {
        continue;
      }

      const sv = await this.db.query.schemaVersion.findFirst({
        where: eq(schemaVersion.id, ff.schemaVersionId),
      });
      if (!sv || !sv.schemaSDL) {
        continue;
      }

      const baseSubgraph = await subgraphRepo.byId(ff.baseSubgraphId);
      if (!baseSubgraph) {
        continue;
      }
      enabledFetaureFlagsByGroup.push({
        ...ff,
        readme: ff.readme || undefined,
        subscriptionUrl: ff.subscriptionUrl ?? '',
        subscriptionProtocol: ff.subscriptionProtocol ?? 'ws',
        websocketSubprotocol: ff.websocketSubprotocol || undefined,
        creatorUserId: ff.createdBy || undefined,
        schemaSDL: sv.schemaSDL,
        lastUpdatedAt: sv.createdAt.toISOString(),
        labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
        namespace: ff.namespaceName,
        schemaVersionId: sv.id,
        baseSubgraphName: baseSubgraph.name,
      });
    }
    return enabledFetaureFlagsByGroup;
  }

  // evaluates all the ffgs which have ffs whose base subgraph id is the passed as input and returns the ffgs that should be composed
  public async getEnabledFeatureFlagGroupsBySubgraphIdAndLabels({
    subgraphId,
    namespaceId,
    baseSubgraphNames,
    labelMatchers,
  }: {
    subgraphId: string;
    namespaceId: string;
    baseSubgraphNames: string[];
    labelMatchers: string[];
  }): Promise<FeatureFlagGroupWithEnabledFeatureFlags[]> {
    const featureFlagGroupWithEnabledFeatureFlags: FeatureFlagGroupWithEnabledFeatureFlags[] = [];
    const enabledFeatureFlagGroups = await this.getEnabledFeatureFlagGroupsBySubgraphId({
      subgraphId,
      namespaceId,
    });

    for (const enabledFeatureFlagGroup of enabledFeatureFlagGroups) {
      // TODO perform label matching - label of the group with fed graph
      const enabledFeatureFlagsByGroup = await this.getEnabledFeatureFlagsByGroupId({
        featureFlagGroupId: enabledFeatureFlagGroup.id,
      });

      // if there are no enabled feature flags in the group, then skip the group
      if (enabledFeatureFlagsByGroup.length === 0) {
        continue;
      }

      const baseSubraphNamesOfFeatureFlags = enabledFeatureFlagsByGroup.map((ff) => ff.baseSubgraphName);
      // check if all base subgraphs of feature flags are one of the base subgraphs of this composition
      const isSubset = baseSubraphNamesOfFeatureFlags.every((name) => baseSubgraphNames.includes(name));
      if (!isSubset) {
        continue;
      }

      featureFlagGroupWithEnabledFeatureFlags.push({
        id: enabledFeatureFlagGroup.id,
        name: enabledFeatureFlagGroup.name,
        enabledFeatureFlags: enabledFeatureFlagsByGroup,
      });
    }
    return featureFlagGroupWithEnabledFeatureFlags;
  }

  // evaluates all the ffs and ffgs and returns the compositon possibilities(the subgraphs that should be composed)
  public async getCompositionPosibilities({
    subgraphs,
    fedGraphLabelMatchers,
    baseCompositionSubgraphs,
  }: {
    subgraphs: SubgraphDTO[];
    fedGraphLabelMatchers: string[];
    baseCompositionSubgraphs: Subgraph[];
  }): Promise<CompositionPossibilities[]> {
    const compositionPossibilities: CompositionPossibilities[] = [
      { compositionSubgraphs: baseCompositionSubgraphs, isFeatureFlagComposition: false, subgraphs },
    ];
    const featureFlagGroupsToBeComposed: FeatureFlagGroupWithEnabledFeatureFlags[] = [];
    for (const subgraph of subgraphs) {
      // for each subgraph, fetch its feature flags
      const featureFlags = await this.getEnabledFeatureFlagsBySubgraphIdAndLabels({
        subgraphId: subgraph.id,
        namespaceId: subgraph.namespaceId,
        labelMatchers: fedGraphLabelMatchers,
      });
      if (featureFlags.length === 0) {
        continue;
      }
      // replace the subgraph with its feature flag
      const compositionSubgraphs = baseCompositionSubgraphs.filter((b) => b.name !== subgraph.name);
      const subgraphDTOs = subgraphs.filter((s) => s.name !== subgraph.name);
      for (const featureFlag of featureFlags) {
        compositionPossibilities.push({
          compositionSubgraphs: [
            ...compositionSubgraphs,
            { name: featureFlag.name, url: featureFlag.routingUrl, definitions: parse(featureFlag.schemaSDL) },
          ],
          isFeatureFlagComposition: true,
          featureFlagName: featureFlag.name,
          subgraphs: [...subgraphDTOs, featureFlag],
        });
      }

      // fetching all the ffgs which have ffs whose base subgraph id is the passed as input
      const enabledFeatureFlagGroups = await this.getEnabledFeatureFlagGroupsBySubgraphIdAndLabels({
        subgraphId: subgraph.id,
        namespaceId: subgraph.namespaceId,
        labelMatchers: fedGraphLabelMatchers,
        baseSubgraphNames: baseCompositionSubgraphs.map((b) => b.name),
      });
      for (const group of enabledFeatureFlagGroups) {
        const found = featureFlagGroupsToBeComposed.some((g) => g.id === group.id);
        if (found) {
          continue;
        }
        featureFlagGroupsToBeComposed.push(group);
      }
    }

    for (const group of featureFlagGroupsToBeComposed) {
      let compositionSubgraphs = baseCompositionSubgraphs;
      let subgraphDTOs = subgraphs;
      if (group.enabledFeatureFlags.length > 0) {
        for (const featureFlag of group.enabledFeatureFlags) {
          compositionSubgraphs = compositionSubgraphs.filter((b) => b.name !== featureFlag.baseSubgraphName);
          subgraphDTOs = subgraphDTOs.filter((s) => s.name !== featureFlag.baseSubgraphName);
          compositionSubgraphs.push({
            name: featureFlag.name,
            url: featureFlag.routingUrl,
            definitions: parse(featureFlag.schemaSDL),
          });
          subgraphDTOs.push(featureFlag);
        }
        compositionPossibilities.push({
          compositionSubgraphs,
          isFeatureFlagComposition: true,
          featureFlagName: group.name,
          subgraphs: subgraphDTOs,
        });
      }
    }
    return compositionPossibilities;
  }

  public async getFFRouterConfigsBySchemaVersionIds({
    ffSchemaVersions,
  }: {
    ffSchemaVersions: {
      featureFlagName: string;
      schemaVersionId: string;
    }[];
  }): Promise<{
    [key: string]: FeatureFlagRouterExecutionConfig;
  }> {
    const ffRouterConfigs: {
      [key: string]: FeatureFlagRouterExecutionConfig;
    } = {};
    const schemaVersionIds = ffSchemaVersions.map((s) => s.schemaVersionId);

    const compositions = await this.db
      .select({
        schemaVersionId: schemaVersion.id,
        routerConfig: graphCompositions.routerConfig,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(graphCompositions.schemaVersionId, schemaVersion.id))
      .where(and(inArray(schemaVersion.id, schemaVersionIds), eq(graphCompositions.isComposable, true)))
      .execute();

    for (const composition of compositions) {
      const ffSchemaVersion = ffSchemaVersions.find((s) => s.schemaVersionId === composition.schemaVersionId);
      if (!ffSchemaVersion) {
        continue;
      }
      const ffRouterConfig = ffRouterConfigFromJson(composition.routerConfig as JsonValue);
      ffRouterConfigs[ffSchemaVersion.featureFlagName] = ffRouterConfig;
    }

    return ffRouterConfigs;
  }
}
