import { JsonValue } from '@bufbuild/protobuf';
import { and, asc, desc, eq, exists, inArray, not, notExists, notInArray, SQL, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { CompositionError, SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel, normalizeURL } from '@wundergraph/cosmo-shared';
import * as schema from '../../db/schema.js';
import {
  federatedGraphs,
  graphApiTokens,
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
  SchemaChangeType,
} from '../../types/index.js';
import { updateComposedSchema } from '../composition/updateComposedSchema.js';
import { normalizeLabelMatchers, normalizeLabels } from '../util.js';
import { SubgraphRepository } from './SubgraphRepository.js';

/**
 * Repository for managing V1 federated graphs.
 */
export class FederatedGraphRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>, private organizationId: string) {}

  public create(data: { name: string; routingUrl: string; labelMatchers: string[] }): Promise<FederatedGraphDTO> {
    return this.db.transaction(async (db) => {
      const subgraphRepo = new SubgraphRepository(db, this.organizationId);

      const labelMatchers = normalizeLabelMatchers(data.labelMatchers);
      const routingUrl = normalizeURL(data.routingUrl);

      const insertedTarget = await db
        .insert(targets)
        .values({
          organizationId: this.organizationId,
          name: data.name,
          type: 'federated',
        })
        .returning()
        .execute();

      const insertedGraph = await db
        .insert(federatedGraphs)
        .values({
          targetId: insertedTarget[0].id,
          routingUrl,
        })
        .returning()
        .execute();

      await db
        .insert(schema.targetLabelMatchers)
        .values(
          labelMatchers.map((s) => ({
            targetId: insertedTarget[0].id,
            labelMatcher: s.split(','),
          })),
        )
        .execute();

      const subgraphs = await subgraphRepo.byGraphLabelMatchers(data.labelMatchers);

      const ops = subgraphs.map((sg) => {
        return db
          .insert(schema.subgraphsToFederatedGraph)
          .values({
            subgraphId: sg.id,
            federatedGraphId: insertedGraph[0].id,
          })
          .execute();
      });

      await Promise.all(ops);

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

  public async update(data: {
    name: string;
    routingUrl: string;
    labelMatchers: string[];
  }): Promise<CompositionError[]> {
    const compositionErrors: CompositionError[] = [];

    const federatedGraph = await this.byName(data.name);
    if (!federatedGraph) {
      return compositionErrors;
    }

    const labelMatchers = normalizeLabelMatchers(data.labelMatchers);
    const routingUrl = normalizeURL(data.routingUrl);

    await this.db.transaction(async (db) => {
      const fedGraphRepo = new FederatedGraphRepository(db, this.organizationId);
      const subgraphRepo = new SubgraphRepository(db, this.organizationId);

      if (labelMatchers.length > 0) {
        // update label matchers
        await db
          .delete(schema.targetLabelMatchers)
          .where(eq(schema.targetLabelMatchers.targetId, federatedGraph.targetId));

        await db
          .insert(schema.targetLabelMatchers)
          .values(
            labelMatchers.map((s) => ({
              targetId: federatedGraph.targetId,
              labelMatcher: s.split(','),
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
              subgraphs.map((sg) => sg.id),
            ),
          );
        }

        await db.delete(schema.subgraphsToFederatedGraph).where(deleteCondition);

        const ops = subgraphs.map((sg) => {
          return db
            .insert(schema.subgraphsToFederatedGraph)
            .values({
              subgraphId: sg.id,
              federatedGraphId: federatedGraph.id,
            })
            .onConflictDoNothing()
            .execute();
        });

        await Promise.all(ops);

        // update schema since subgraphs would have changed
        const errors = await updateComposedSchema({
          federatedGraph,
          fedGraphRepo,
          subgraphRepo,
        });

        compositionErrors.push(...errors);
      }

      // update routing URL
      if (data.routingUrl !== '') {
        await db.update(federatedGraphs).set({ routingUrl }).where(eq(federatedGraphs.id, federatedGraph.id)).execute();
      }
    });

    return compositionErrors;
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
            composedSchemaVersion: {
              // Don't load the schema SDL, since it can be very large.
              columns: {
                id: true,
                isComposable: true,
                compositionErrors: true,
                createdAt: true,
              },
            },
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

    // Composed schema version is not set when the federated graph is not composed.

    return {
      id: resp.federatedGraph.id,
      name: resp.name,
      routingUrl: resp.federatedGraph.routingUrl,
      isComposable: resp.federatedGraph.composedSchemaVersion?.isComposable ?? false,
      compositionErrors: resp.federatedGraph.composedSchemaVersion?.compositionErrors ?? '',
      lastUpdatedAt: resp.federatedGraph.composedSchemaVersion?.createdAt?.toISOString() ?? '',
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

  public updateSchema({
    composedSDL,
    graphName,
    compositionErrors,
    routerConfig,
  }: {
    graphName: string;
    composedSDL?: string;
    compositionErrors?: Error[];
    routerConfig?: JsonValue;
  }) {
    return this.db.transaction<FederatedGraphDTO | undefined>(async (db) => {
      const fedGraphRepo = new FederatedGraphRepository(db, this.organizationId);
      const fedGraph = await fedGraphRepo.byName(graphName);
      if (fedGraph === undefined) {
        return undefined;
      }

      let compositionErrorString = '';

      if (compositionErrors && compositionErrors.length > 0) {
        compositionErrorString = compositionErrors.map((e) => e.toString()).join('\n');
      }

      const insertedVersion = await db
        .insert(schemaVersion)
        .values({
          targetId: fedGraph.targetId,
          schemaSDL: composedSDL,
          isComposable: compositionErrorString === '',
          compositionErrors: compositionErrorString,
          routerConfig: routerConfig || null,
        })
        .returning({
          insertedId: schemaVersion.id,
        });

      await db
        .update(federatedGraphs)
        .set({
          // Update the schema of the federated graph with a valid schema version.
          composedSchemaVersionId: insertedVersion[0].insertedId,
        })
        .where(eq(federatedGraphs.id, fedGraph.id));

      return {
        id: fedGraph.id,
        targetId: fedGraph.targetId,
        name: fedGraph.name,
        labelMatchers: fedGraph.labelMatchers,
        isComposable: fedGraph.isComposable,
        compositionErrors: compositionErrorString,
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

  public async isLatestVersion(name: string, version: string) {
    const res = await this.byName(name);
    return res?.schemaVersionId === version;
  }

  public async getLatestValidRouterConfig(name: string): Promise<
    | {
        config: RouterConfig;
        version: string;
      }
    | undefined
  > {
    const validVersion = await this.db
      .select({
        versionId: schemaVersion.id,
        routerConfig: schemaVersion.routerConfig,
      })
      .from(targets)
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
      .innerJoin(schemaVersion, eq(schemaVersion.id, federatedGraphs.composedSchemaVersionId))
      .where(
        and(
          eq(targets.type, 'federated'),
          eq(targets.organizationId, this.organizationId),
          eq(targets.name, name),
          eq(schemaVersion.isComposable, true),
        ),
      )
      .limit(1)
      .execute();

    if (validVersion.length === 0) {
      return undefined;
    }

    return {
      config: RouterConfig.fromJson(validVersion[0].routerConfig as JsonValue),
      version: validVersion[0].versionId ?? '',
    };
  }

  public async getLatestSdlOfFederatedGraph(name: string) {
    const latestVersion = await this.db
      .select({
        name: targets.name,
        schemaSDL: schemaVersion.schemaSDL,
      })
      .from(targets)
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
      .leftJoin(schemaVersion, eq(schemaVersion.id, federatedGraphs.composedSchemaVersionId))
      .where(
        and(eq(targets.type, 'federated'), eq(targets.organizationId, this.organizationId), eq(targets.name, name)),
      )
      .limit(1)
      .execute();

    if (latestVersion.length === 0) {
      return undefined;
    }

    return latestVersion[0].schemaSDL;
  }

  public createFederatedGraphChangelog(data: { schemaVersionID: string; changes: SchemaChange[] }) {
    return this.db.transaction(async (db) => {
      const ops = data.changes.map((change) => {
        return db
          .insert(schemaVersionChangeAction)
          .values({
            schemaVersionId: data.schemaVersionID,
            changeType: change.changeType as SchemaChangeType,
            changeMessage: change.message,
            path: change.path,
          })
          .execute();
      });
      await Promise.all(ops);
    });
  }

  public fetchFederatedGraphChangelog(
    targetId: string,
    limit: number,
    offset: number,
  ): Promise<{ federatedGraphChangelog: FederatedGraphChangelogDTO[]; hasNextPage: boolean } | undefined> {
    return this.db.transaction<
      { federatedGraphChangelog: FederatedGraphChangelogDTO[]; hasNextPage: boolean } | undefined
    >(async (db) => {
      const federatedGraphChangelog: FederatedGraphChangelogDTO[] = [];

      // Get all schema version ids which have changelogs
      const schemaVersionIds = (
        await db
          .select({
            id: schemaVersion.id,
          })
          .from(schemaVersion)
          .where(eq(schemaVersion.targetId, targetId))
          .innerJoin(schemaVersionChangeAction, eq(schemaVersionChangeAction.schemaVersionId, schemaVersion.id))
          .orderBy(desc(schemaVersion.createdAt))
          .groupBy(schemaVersion.id)
          .offset(offset)
          .limit(limit)
      ).map((sv) => sv.id);

      if (schemaVersionIds.length === 0) {
        return { federatedGraphChangelog, hasNextPage: false };
      }

      const schemaVersions = await db.query.schemaVersion.findMany({
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

      const entriesAfterCurrentPage = await db
        .select({ id: schemaVersion.id })
        .from(schemaVersion)
        .innerJoin(schemaVersionChangeAction, eq(schemaVersionChangeAction.schemaVersionId, schemaVersion.id))
        .where(eq(schemaVersion.targetId, targetId))
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

  public delete(targetID: string, subgraphsTargetIDs: string[]) {
    return this.db.transaction(async (db) => {
      await db.delete(targets).where(eq(targets.id, targetID)).execute();
      if (subgraphsTargetIDs.length > 0) {
        await db.delete(schemaChecks).where(inArray(schemaChecks.targetId, subgraphsTargetIDs)).execute();
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
    };
  }
}
