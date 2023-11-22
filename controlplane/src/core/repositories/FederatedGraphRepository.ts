import { JsonValue } from '@bufbuild/protobuf';
import { and, asc, desc, eq, gt, inArray, lt, not, notExists, notInArray, SQL, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { joinLabel, normalizeURL } from '@wundergraph/cosmo-shared';
import * as schema from '../../db/schema.js';
import {
  federatedGraphs,
  graphApiTokens,
  graphCompositions,
  schemaChecks,
  schemaVersion,
  schemaVersionChangeAction,
  targetLabelMatchers,
  targets,
} from '../../db/schema.js';
import {
  FederatedGraphChangelogDTO,
  FederatedGraphDTO,
  GraphApiKeyDTO,
  Label,
  ListFilterOptions,
} from '../../types/index.js';
import { normalizeLabelMatchers, normalizeLabels } from '../util.js';
import { Composer } from '../composition/composer.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { Target } from '../../db/models.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { GraphCompositionRepository } from './GraphCompositionRepository.js';

export interface FederatedGraphConfig {
  trafficCheckDays: number;
}

/**
 * Repository for managing V1 federated graphs.
 */
export class FederatedGraphRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public create(data: { name: string; routingUrl: string; labelMatchers: string[] }): Promise<FederatedGraphDTO> {
    return this.db.transaction(async (tx) => {
      const subgraphRepo = new SubgraphRepository(tx, this.organizationId);

      const labelMatchers = normalizeLabelMatchers(data.labelMatchers);
      const routingUrl = normalizeURL(data.routingUrl);

      const insertedTarget = await tx
        .insert(targets)
        .values({
          organizationId: this.organizationId,
          name: data.name,
          type: 'federated',
        })
        .returning()
        .execute();

      const insertedGraph = await tx
        .insert(federatedGraphs)
        .values({
          targetId: insertedTarget[0].id,
          routingUrl,
        })
        .returning()
        .execute();

      await tx
        .insert(schema.targetLabelMatchers)
        .values(
          labelMatchers.map((s) => ({
            targetId: insertedTarget[0].id,
            labelMatcher: s.split(','),
          })),
        )
        .execute();

      const subgraphs = await subgraphRepo.byGraphLabelMatchers(data.labelMatchers);

      if (subgraphs.length > 0) {
        await tx
          .insert(schema.subgraphsToFederatedGraph)
          .values(
            subgraphs.map((sg) => ({
              subgraphId: sg.id,
              federatedGraphId: insertedGraph[0].id,
            })),
          )
          .execute();
      }

      return {
        id: insertedGraph[0].id,
        targetId: insertedTarget[0].id,
        name: insertedTarget[0].name,
        isComposable: false,
        routingUrl: insertedGraph[0].routingUrl,
        compositionErrors: '',
        lastUpdatedAt: '',
        labelMatchers: data.labelMatchers,
        subgraphsCount: subgraphs.length,
      };
    });
  }

  public update(data: { name: string; routingUrl: string; labelMatchers: string[]; updatedBy: string }) {
    const labelMatchers = normalizeLabelMatchers(data.labelMatchers);
    const routingUrl = normalizeURL(data.routingUrl);

    return this.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(tx, this.organizationId);
      const subgraphRepo = new SubgraphRepository(tx, this.organizationId);
      const compositionRepo = new GraphCompositionRepository(tx);

      const federatedGraph = await fedGraphRepo.byName(data.name);
      if (!federatedGraph) {
        throw new Error(`FederatedGraph ${data.name} not found`);
      }

      // update routing URL when changed
      if (federatedGraph.routingUrl && federatedGraph.routingUrl !== routingUrl) {
        await tx.update(federatedGraphs).set({ routingUrl }).where(eq(federatedGraphs.id, federatedGraph.id)).execute();
      }

      if (labelMatchers.length > 0) {
        // update label matchers
        await tx
          .delete(schema.targetLabelMatchers)
          .where(eq(schema.targetLabelMatchers.targetId, federatedGraph.targetId));

        await tx
          .insert(schema.targetLabelMatchers)
          .values(
            labelMatchers.map((labelMatcher) => ({
              targetId: federatedGraph.targetId,
              labelMatcher: labelMatcher.split(','),
            })),
          )
          .execute();

        const subgraphs = await subgraphRepo.byGraphLabelMatchers(labelMatchers);

        let deleteCondition: SQL<unknown> | undefined = eq(
          schema.subgraphsToFederatedGraph.federatedGraphId,
          federatedGraph.id,
        );

        // we do this conditionally because notInArray cannot take empty value
        if (subgraphs.length > 0) {
          deleteCondition = and(
            deleteCondition,
            notInArray(
              schema.subgraphsToFederatedGraph.subgraphId,
              subgraphs.map((subgraph) => subgraph.id),
            ),
          );
        }

        await tx.delete(schema.subgraphsToFederatedGraph).where(deleteCondition);

        if (subgraphs.length > 0) {
          await tx
            .insert(schema.subgraphsToFederatedGraph)
            .values(
              subgraphs.map((sg) => ({
                subgraphId: sg.id,
                federatedGraphId: federatedGraph.id,
              })),
            )
            .onConflictDoNothing()
            .execute();
        }

        const composer = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);
        const composedGraph = await composer.composeFederatedGraph(federatedGraph);

        await composer.deployComposition(composedGraph, data.updatedBy);

        return composedGraph.errors;
      }
    });
  }

  public async list(opts: ListFilterOptions): Promise<FederatedGraphDTO[]> {
    const targets = await this.db.query.targets.findMany({
      where: and(eq(schema.targets.type, 'federated'), eq(schema.targets.organizationId, this.organizationId)),
      limit: opts.limit,
      offset: opts.offset,
    });

    const federatedGraphs: FederatedGraphDTO[] = [];

    for (const target of targets) {
      const fg = await this.byName(target.name);
      if (fg === undefined) {
        throw new Error(`FederatedGraph ${target.name} not found`);
      }
      federatedGraphs.push(fg);
    }

    return federatedGraphs;
  }

  public async targetByName(name: string): Promise<Target | undefined> {
    const resp = await this.db.query.targets.findFirst({
      where: and(
        eq(schema.targets.name, name),
        eq(schema.targets.organizationId, this.organizationId),
        eq(schema.targets.type, 'federated'),
      ),
    });

    if (!resp) {
      return undefined;
    }

    return resp;
  }

  public async byName(name: string): Promise<FederatedGraphDTO | undefined> {
    const resp = await this.db.query.targets.findFirst({
      where: and(
        eq(schema.targets.name, name),
        eq(schema.targets.organizationId, this.organizationId),
        eq(schema.targets.type, 'federated'),
      ),
      with: {
        federatedGraph: {
          with: {
            subgraphs: {
              columns: {
                subgraphId: true,
              },
            },
          },
        },
        labelMatchers: true,
      },
    });

    if (!resp) {
      return undefined;
    }

    const latestVersion = await this.db
      .select({
        id: schemaVersion.id,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        createdAt: schemaVersion.createdAt,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .where(eq(schemaVersion.targetId, resp.federatedGraph.targetId))
      .orderBy(desc(schemaVersion.createdAt))
      .limit(1)
      .execute();

    // Composed schema version is not set when the federated graph was not composed.
    return {
      id: resp.federatedGraph.id,
      name: resp.name,
      routingUrl: resp.federatedGraph.routingUrl,
      isComposable: latestVersion?.[0]?.isComposable ?? false,
      compositionErrors: latestVersion?.[0]?.compositionErrors ?? '',
      lastUpdatedAt: latestVersion?.[0]?.createdAt?.toISOString() ?? '',
      targetId: resp.id,
      schemaVersionId: resp.federatedGraph.composedSchemaVersionId ?? undefined,
      subgraphsCount: resp.federatedGraph.subgraphs.length ?? 0,
      labelMatchers: resp.labelMatchers.map((s) => s.labelMatcher.join(',')),
    };
  }

  /**
   * bySubgraphLabels returns federated graphs whose label matchers satisfy the given subgraph labels.
   */
  public async bySubgraphLabels(labels: Label[]): Promise<FederatedGraphDTO[]> {
    const uniqueLabels = normalizeLabels(labels);

    const graphs = await this.db
      .select({
        name: targets.name,
      })
      .from(targets)
      .where(
        and(
          eq(targets.organizationId, this.organizationId),
          eq(targets.type, 'federated'),
          // This is a negative lookup. We check if there is a label matchers of a federated graph
          // that does not match the given subgraph labels. If all label matchers match, then the
          // federated graph will be part of the result.
          notExists(
            this.db
              .select()
              .from(targetLabelMatchers)
              .where(
                and(
                  eq(targetLabelMatchers.targetId, targets.id),
                  not(
                    // We created a GIN index on the label_matcher column, so we can look up
                    // very quickly if the label matcher matches the given subgraph labels.
                    sql.raw(
                      `${targetLabelMatchers.labelMatcher.name} && ARRAY[${uniqueLabels.map(
                        (ul) => "'" + joinLabel(ul) + "'",
                      )}]`,
                    ),
                  ),
                ),
              ),
          ),
        ),
      )
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
      .leftJoin(schemaVersion, eq(schemaVersion.id, federatedGraphs.composedSchemaVersionId))
      .orderBy(asc(targets.createdAt), asc(schemaVersion.createdAt))
      .execute();

    const graphsDTOs: FederatedGraphDTO[] = [];

    for (const target of graphs) {
      const fg = await this.byName(target.name);
      if (fg === undefined) {
        throw new Error(`FederatedGraph ${target.name} not found`);
      }

      graphsDTOs.push(fg);
    }

    return graphsDTOs;
  }

  /**
   * addSchemaVersion adds a new schema version to the given federated graph. When
   * the schema version is not composable the errors are stored in the compositionErrors
   * but the composedSchemaVersionId is not updated.
   */
  public addSchemaVersion({
    composedSDL,
    graphName,
    compositionErrors,
    routerConfig,
    subgraphSchemaVersionIds,
    composedBy,
  }: {
    graphName: string;
    composedSDL?: string;
    compositionErrors?: Error[];
    routerConfig?: JsonValue;
    subgraphSchemaVersionIds: string[];
    composedBy: string;
  }) {
    return this.db.transaction<FederatedGraphDTO | undefined>(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(tx, this.organizationId);
      const compositionRepo = new GraphCompositionRepository(tx);
      const fedGraph = await fedGraphRepo.byName(graphName);
      if (fedGraph === undefined) {
        return undefined;
      }

      let compositionErrorString = '';

      if (compositionErrors && compositionErrors.length > 0) {
        compositionErrorString = compositionErrors.map((e) => e.toString()).join('\n');
      }

      const insertedVersion = await tx
        .insert(schemaVersion)
        .values({
          targetId: fedGraph.targetId,
          schemaSDL: composedSDL,
        })
        .returning({
          insertedId: schemaVersion.id,
        });

      // Always update the federated schema after composing, even if the schema is not composable.
      // That allows us to display the latest schema version in the UI. The router will only fetch
      // the latest composable schema version.
      await tx
        .update(federatedGraphs)
        .set({
          composedSchemaVersionId: insertedVersion[0].insertedId,
        })
        .where(eq(federatedGraphs.id, fedGraph.id));

      // adding the composition entry and the relation between fedGraph schema version and subgraph schema version
      await compositionRepo.addComposition({
        fedGraphSchemaVersionId: insertedVersion[0].insertedId,
        subgraphSchemaVersionIds,
        compositionErrorString,
        routerConfig,
        composedBy,
      });

      return {
        id: fedGraph.id,
        targetId: fedGraph.targetId,
        name: fedGraph.name,
        labelMatchers: fedGraph.labelMatchers,
        compositionErrors: compositionErrorString,
        isComposable: fedGraph.isComposable,
        lastUpdatedAt: fedGraph.lastUpdatedAt,
        routingUrl: fedGraph.routingUrl,
        subgraphsCount: fedGraph.subgraphsCount,
        composedSchemaVersionId: insertedVersion[0].insertedId,
      };
    });
  }

  public async exists(name: string) {
    const res = await this.byName(name);
    return res !== undefined;
  }

  public async isLatestValidRouterConfigVersion(targetId: string, schemaVersionId: string): Promise<boolean> {
    const latestValidVersion = await this.db
      .select({
        id: schemaVersion.id,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .where(and(eq(schemaVersion.targetId, targetId), eq(graphCompositions.isComposable, true)))
      .orderBy(desc(schemaVersion.createdAt))
      .limit(1)
      .execute();

    return latestValidVersion?.[0]?.id === schemaVersionId;
  }

  public async getLatestValidRouterConfig(targetId: string): Promise<
    | {
        config: RouterConfig;
        schemaVersionId: string;
      }
    | undefined
  > {
    const latestValidVersion = await this.db
      .select({
        id: schemaVersion.id,
        routerConfig: graphCompositions.routerConfig,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .where(and(eq(schemaVersion.targetId, targetId), eq(graphCompositions.isComposable, true)))
      .orderBy(desc(schemaVersion.createdAt))
      .limit(1)
      .execute();

    if (!latestValidVersion || latestValidVersion.length === 0) {
      return undefined;
    }

    return {
      config: RouterConfig.fromJson(latestValidVersion[0].routerConfig as JsonValue),
      schemaVersionId: latestValidVersion[0].id,
    };
  }

  // returns the latest valid schema version of a federated graph
  public async getLatestValidSchemaVersion(name: string) {
    const latestValidVersion = await this.db
      .select({
        name: targets.name,
        schemaSDL: schemaVersion.schemaSDL,
        schemaVersionId: schemaVersion.id,
      })
      .from(targets)
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
      .innerJoin(schemaVersion, eq(schema.schemaVersion.targetId, targets.id))
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .where(
        and(
          eq(targets.type, 'federated'),
          eq(targets.organizationId, this.organizationId),
          eq(targets.name, name),
          eq(graphCompositions.isComposable, true),
        ),
      )
      .orderBy(desc(graphCompositions.createdAt))
      .limit(1)
      .execute();

    if (latestValidVersion.length === 0) {
      return undefined;
    }

    return {
      schema: latestValidVersion[0].schemaSDL,
      schemaVersionId: latestValidVersion[0].schemaVersionId,
    };
  }

  public createFederatedGraphChangelog(data: { schemaVersionID: string; changes: SchemaDiff[] }) {
    return this.db
      .insert(schemaVersionChangeAction)
      .values(
        data.changes.map((change) => ({
          schemaVersionId: data.schemaVersionID,
          changeType: change.changeType,
          changeMessage: change.message,
          path: change.path,
        })),
      )
      .execute();
  }

  public fetchFederatedGraphChangelog(
    targetId: string,
    pagination: {
      limit: number;
      offset: number;
    },
    dateRange: {
      start: string;
      end: string;
    },
  ): Promise<{ federatedGraphChangelog: FederatedGraphChangelogDTO[]; hasNextPage: boolean } | undefined> {
    return this.db.transaction<
      { federatedGraphChangelog: FederatedGraphChangelogDTO[]; hasNextPage: boolean } | undefined
    >(async (tx) => {
      const federatedGraphChangelog: FederatedGraphChangelogDTO[] = [];

      const { offset, limit } = pagination;
      const { start, end } = dateRange;

      // Get all schema version ids which have changelogs
      const schemaVersionIds = (
        await tx
          .select({
            id: schemaVersion.id,
          })
          .from(schemaVersion)
          .where(
            and(
              eq(schemaVersion.targetId, targetId),
              gt(schemaVersion.createdAt, new Date(start)),
              lt(schemaVersion.createdAt, new Date(end)),
            ),
          )
          .innerJoin(schemaVersionChangeAction, eq(schemaVersionChangeAction.schemaVersionId, schemaVersion.id))
          .orderBy(desc(schemaVersion.createdAt))
          .groupBy(schemaVersion.id)
          .offset(offset)
          .limit(limit)
      ).map((sv) => sv.id);

      if (schemaVersionIds.length === 0) {
        return { federatedGraphChangelog, hasNextPage: false };
      }

      const schemaVersions = await tx.query.schemaVersion.findMany({
        where: (sv) => inArray(sv.id, schemaVersionIds),
        columns: {
          id: true,
          createdAt: true,
        },
        with: {
          changes: {
            orderBy: desc(schemaVersionChangeAction.createdAt),
          },
        },
        orderBy: desc(schemaVersion.createdAt),
      });

      const entriesAfterCurrentPage = await tx
        .select({ id: schemaVersion.id })
        .from(schemaVersion)
        .innerJoin(schemaVersionChangeAction, eq(schemaVersionChangeAction.schemaVersionId, schemaVersion.id))
        .where(
          and(
            eq(schemaVersion.targetId, targetId),
            gt(schemaVersion.createdAt, new Date(start)),
            lt(schemaVersion.createdAt, new Date(end)),
          ),
        )
        .orderBy(desc(schemaVersion.createdAt))
        .groupBy(schemaVersion.id)
        .offset(offset + schemaVersions.length)
        .limit(limit);

      for (const sv of schemaVersions) {
        federatedGraphChangelog.push({
          schemaVersionId: sv.id,
          createdAt: sv.createdAt.toString(),
          changelogs: sv.changes.map((c) => ({
            id: c.id,
            path: c.path || '',
            changeType: c.changeType,
            changeMessage: c.changeMessage,
            createdAt: c.createdAt.toString(),
          })),
        });
      }

      return { federatedGraphChangelog, hasNextPage: entriesAfterCurrentPage.length > 0 };
    });
  }

  public async fetchLatestFederatedGraphChangelog(
    federatedGraphId: string,
  ): Promise<FederatedGraphChangelogDTO | undefined> {
    const federatedGraph = await this.db
      .select({ schemaVersionId: federatedGraphs.composedSchemaVersionId })
      .from(federatedGraphs)
      .innerJoin(targets, eq(targets.id, federatedGraphs.targetId))
      .where(and(eq(federatedGraphs.id, federatedGraphId), eq(targets.organizationId, this.organizationId)));

    if (federatedGraph.length === 0) {
      return undefined;
    }

    if (!federatedGraph[0].schemaVersionId) {
      return undefined;
    }

    const changelogs = await this.db
      .select({
        id: schemaVersionChangeAction.id,
        path: schemaVersionChangeAction.path,
        changeType: schemaVersionChangeAction.changeType,
        changeMessage: schemaVersionChangeAction.changeMessage,
        createdAt: schemaVersionChangeAction.createdAt,
      })
      .from(schemaVersionChangeAction)
      .where(eq(schemaVersionChangeAction.schemaVersionId, federatedGraph[0].schemaVersionId));

    if (changelogs.length === 0) {
      return undefined;
    }

    return {
      schemaVersionId: federatedGraph[0].schemaVersionId,
      createdAt: changelogs[0].createdAt.toString(),
      changelogs: changelogs.map((c) => ({
        id: c.id,
        path: c.path || '',
        changeType: c.changeType,
        changeMessage: c.changeMessage,
        createdAt: c.createdAt.toString(),
      })),
    };
  }

  public delete(targetID: string, subgraphsTargetIDs: string[]) {
    return this.db.transaction(async (tx) => {
      await tx.delete(targets).where(eq(targets.id, targetID)).execute();
      if (subgraphsTargetIDs.length > 0) {
        await tx.delete(schemaChecks).where(inArray(schemaChecks.targetId, subgraphsTargetIDs)).execute();
      }
    });
  }

  public async createToken(input: {
    tokenName: string;
    token: string;
    organizationId: string;
    federatedGraphId: string;
  }): Promise<GraphApiKeyDTO> {
    const keys = await this.db
      .insert(graphApiTokens)
      .values({
        name: input.tokenName,
        token: input.token,
        organizationId: input.organizationId,
        federatedGraphId: input.federatedGraphId,
      })
      .returning()
      .execute();

    if (keys.length === 0) {
      throw new Error('Failed to create token');
    }

    const key = keys[0];

    return {
      id: key.id,
      name: key.name,
      token: key.token,
      createdAt: key.createdAt.toISOString(),
    };
  }

  public async deleteToken(input: { tokenName: string; organizationId: string; federatedGraphId: string }) {
    await this.db
      .delete(graphApiTokens)
      .where(
        and(
          eq(graphApiTokens.organizationId, input.organizationId),
          eq(graphApiTokens.federatedGraphId, input.federatedGraphId),
          eq(graphApiTokens.name, input.tokenName),
        ),
      )
      .execute();
  }

  public async getRouterToken(input: {
    organizationId: string;
    federatedGraphId: string;
    tokenName: string;
  }): Promise<GraphApiKeyDTO | undefined> {
    const tokens = await this.db
      .select({
        id: graphApiTokens.id,
        name: graphApiTokens.name,
        createdAt: graphApiTokens.createdAt,
        token: graphApiTokens.token,
      })
      .from(graphApiTokens)
      .where(
        and(
          eq(graphApiTokens.organizationId, input.organizationId),
          eq(graphApiTokens.federatedGraphId, input.federatedGraphId),
          eq(graphApiTokens.name, input.tokenName),
        ),
      )
      .execute();

    if (tokens.length === 0) {
      return undefined;
    }

    return {
      id: tokens[0].id,
      name: tokens[0].name,
      createdAt: tokens[0].createdAt.toISOString(),
      token: tokens[0].token,
    } as GraphApiKeyDTO;
  }

  public async getRouterTokens(input: { organizationId: string; federatedGraphId: string }): Promise<GraphApiKeyDTO[]> {
    const tokens = await this.db
      .select({
        id: graphApiTokens.id,
        name: graphApiTokens.name,
        createdAt: graphApiTokens.createdAt,
        token: graphApiTokens.token,
      })
      .from(graphApiTokens)
      .where(
        and(
          eq(graphApiTokens.organizationId, input.organizationId),
          eq(graphApiTokens.federatedGraphId, input.federatedGraphId),
        ),
      )
      .execute();

    return tokens.map(
      (token) =>
        ({
          id: token.id,
          name: token.name,
          createdAt: token.createdAt.toISOString(),
          token: token.token,
        }) as GraphApiKeyDTO,
    );
  }
}
