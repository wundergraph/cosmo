/* eslint-disable no-labels */
import type { Warning } from '@wundergraph/composition';
import { joinLabel, normalizeURL } from '@wundergraph/cosmo-shared';
import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  not,
  notExists,
  notInArray,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { generateKeyPair, importPKCS8, SignJWT } from 'jose';
import { KeyObject } from 'node:crypto';
import { uid } from 'uid/secure';
import * as schema from '../../db/schema.js';
import {
  federatedGraphs,
  federatedGraphsToFeatureFlagSchemaVersions,
  graphApiTokens,
  graphCompositions,
  graphRequestKeys,
  schemaVersion,
  schemaVersionChangeAction,
  targetLabelMatchers,
  targets,
  users,
} from '../../db/schema.js';
import {
  ComposeAndDeployResult,
  DateRange,
  FederatedGraphChangelogDTO,
  FederatedGraphDTO,
  FederatedGraphListFilterOptions,
  GraphApiKeyDTO,
  Label,
  RouterRequestKeysDTO
} from '../../types/index.js';
import { CompositionSubgraphRecord } from '../composition/composer.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import type { CompositionService } from '../services/CompositionService.js';
import { RBACEvaluator } from '../services/RBACEvaluator.js';
import { traced } from '../tracing.js';
import {
  applyIdpNamespaceGate,
  checkIfLabelMatchersChanged,
  normalizeLabelMatchers,
  normalizeLabels,
} from '../util.js';
import { ContractRepository } from './ContractRepository.js';
import { GraphCompositionRepository } from './GraphCompositionRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { TargetRepository } from './TargetRepository.js';
import { UserRepository } from './UserRepository.js';

export interface FederatedGraphConfig {
  trafficCheckDays: number;
}

@traced
export class FederatedGraphRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public create(data: {
    name: string;
    namespace: string;
    namespaceId: string;
    routingUrl: string;
    labelMatchers: string[];
    createdBy: string;
    readme?: string;
    supportsFederation?: boolean;
    admissionWebhookURL?: string;
    admissionWebhookSecret?: string;
  }): Promise<FederatedGraphDTO> {
    return this.db.transaction(async (tx) => {
      const subgraphRepo = new SubgraphRepository(this.logger, tx, this.organizationId);

      const labelMatchers = normalizeLabelMatchers(data.labelMatchers);
      const routingUrl = normalizeURL(data.routingUrl);
      const admissionWebhookURL = data.admissionWebhookURL ? normalizeURL(data.admissionWebhookURL) : undefined;

      const insertedTarget = await tx
        .insert(targets)
        .values({
          organizationId: this.organizationId,
          name: data.name,
          type: 'federated',
          createdBy: data.createdBy,
          readme: data.readme,
          namespaceId: data.namespaceId,
        })
        .returning()
        .execute();

      const insertedGraph = await tx
        .insert(federatedGraphs)
        .values({
          targetId: insertedTarget[0].id,
          admissionWebhookURL,
          admissionWebhookSecret: data.admissionWebhookSecret || null,
          routingUrl,
          supportsFederation: data.supportsFederation,
        })
        .returning()
        .execute();

      if (labelMatchers.length > 0) {
        await tx
          .insert(schema.targetLabelMatchers)
          .values(
            labelMatchers.map((s) => ({
              targetId: insertedTarget[0].id,
              labelMatcher: s.split(','),
            })),
          )
          .execute();
      }

      const subgraphs = await subgraphRepo.byGraphLabelMatchers({
        labelMatchers: data.labelMatchers,
        namespaceId: data.namespaceId,
      });

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
        admissionWebhookURL: insertedGraph[0].admissionWebhookURL ?? '',
        compositionErrors: '',
        lastUpdatedAt: '',
        labelMatchers: data.labelMatchers,
        subgraphsCount: subgraphs.length,
        namespace: data.namespace,
        namespaceId: data.namespaceId,
        supportsFederation: insertedGraph[0].supportsFederation,
        routerCompatibilityVersion: insertedGraph[0].routerCompatibilityVersion,
        organizationId: this.organizationId,
      };
    });
  }

  public async update({
    compositionService,
    ...data
  }: {
    compositionService: CompositionService;
    labelMatchers: string[];
    namespaceId: string;
    routingUrl: string;
    targetId: string;
    updatedBy: string;
    admissionWebhookSecret?: string;
    admissionWebhookURL?: string;
    readme?: string;
    unsetLabelMatchers?: boolean;
  }): Promise<ComposeAndDeployResult | undefined> {
    const routingUrl = normalizeURL(data.routingUrl);
    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);
    const targetRepo = new TargetRepository(this.db, this.organizationId);
    const contractRepo = new ContractRepository(this.logger, this.db, this.organizationId);

    const federatedGraph = await fedGraphRepo.byTargetId(data.targetId);
    if (!federatedGraph) {
      throw new Error(`Federated graph not found`);
    }

    // Update routing URL when changed. (Is required)
    if (routingUrl && federatedGraph.routingUrl !== routingUrl) {
      await this.db
        .update(federatedGraphs)
        .set({ routingUrl })
        .where(eq(federatedGraphs.id, federatedGraph.id))
        .execute();
    }

    // Update admission webhook URL when changed. (Is optional)
    if (data.admissionWebhookURL !== undefined && federatedGraph.admissionWebhookURL !== data.admissionWebhookURL) {
      const admissionWebhookURL = data.admissionWebhookURL ? normalizeURL(data.admissionWebhookURL) : '';

      await this.db
        .update(federatedGraphs)
        .set({ admissionWebhookURL: admissionWebhookURL || null })
        .where(eq(federatedGraphs.id, federatedGraph.id))
        .execute();
    }

    if (data.admissionWebhookSecret !== undefined) {
      await this.db
        .update(federatedGraphs)
        .set({ admissionWebhookSecret: data.admissionWebhookSecret || null })
        .where(eq(federatedGraphs.id, federatedGraph.id))
        .execute();
    }

    // Update the readme of the fed graph. (Is optional)
    if (data.readme !== undefined) {
      await targetRepo.updateReadmeOfTarget({ id: data.targetId, readme: data.readme });
    }

    const haveLabelMatchersChanged = checkIfLabelMatchersChanged({
      isContract: !!federatedGraph.contract,
      currentLabelMatchers: federatedGraph.labelMatchers,
      newLabelMatchers: data.labelMatchers,
      unsetLabelMatchers: data.unsetLabelMatchers,
    });

    // Update label matchers (Is optional)
    if (!haveLabelMatchersChanged) {
      return undefined;
    }

    const labelMatchers = data.unsetLabelMatchers ? [] : normalizeLabelMatchers(data.labelMatchers);
    const contracts = await contractRepo.bySourceFederatedGraphId(federatedGraph.id);
    const subgraphs = await subgraphRepo.byGraphLabelMatchers({
      labelMatchers,
      namespaceId: data.namespaceId,
    });

    const graphAndContracts = [federatedGraph, ...contracts.map((c) => c.downstreamFederatedGraph)];
    for (const graph of graphAndContracts) {
      await this.db.delete(schema.targetLabelMatchers).where(eq(schema.targetLabelMatchers.targetId, graph.targetId));

      if (labelMatchers.length > 0) {
        await this.db
          .insert(schema.targetLabelMatchers)
          .values(
            labelMatchers.map((labelMatcher) => ({
              targetId: graph.targetId,
              labelMatcher: labelMatcher.split(','),
            })),
          )
          .execute();
      }

      let deleteCondition: SQL<unknown> | undefined = eq(schema.subgraphsToFederatedGraph.federatedGraphId, graph.id);

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

      await this.db.delete(schema.subgraphsToFederatedGraph).where(deleteCondition);
      if (subgraphs.length > 0) {
        await this.db
          .insert(schema.subgraphsToFederatedGraph)
          .values(
            subgraphs.map((sg) => ({
              subgraphId: sg.id,
              federatedGraphId: graph.id,
            })),
          )
          .onConflictDoNothing()
          .execute();
      }
    }

    // since the label matchers have changed, the current DTO is stale
    const updatedFederatedGraph = await fedGraphRepo.byTargetId(data.targetId);
    if (!updatedFederatedGraph) {
      throw new Error(`Federated graph not found`);
    }

    return await compositionService.composeAndDeployFederatedGraph({
      actorId: data.updatedBy,
      federatedGraph: updatedFederatedGraph,
    });
  }

  public updateReadme({ targetId, readme }: { targetId: string; readme: string }) {
    return this.db
      .update(targets)
      .set({ readme })
      .where(and(eq(targets.id, targetId), eq(schema.targets.organizationId, this.organizationId)));
  }

  /**
   * Move does not call `composeAndDeployFederatedGraph` itself.
   * This is because contracts need to all be moved to the new namespace before `composeAndDeployFederatedGraph`
   * is called.
   *
   * @param data
   */
  public async move(data: {
    targetId: string;
    newNamespaceId: string;
    updatedBy: string;
    federatedGraph: FederatedGraphDTO;
    skipDeployment?: boolean;
  }): Promise<void> {
    const subgraphRepo = new SubgraphRepository(this.logger, this.db, this.organizationId);

    await this.db.update(targets).set({ namespaceId: data.newNamespaceId }).where(eq(targets.id, data.targetId));

    // Delete all mappings because we will deal with new subgraphs in new namespace
    await this.db
      .delete(schema.subgraphsToFederatedGraph)
      .where(eq(schema.subgraphsToFederatedGraph.federatedGraphId, data.federatedGraph.id));

    const newNamespaceSubgraphs = await subgraphRepo.byGraphLabelMatchers({
      labelMatchers: data.federatedGraph.labelMatchers,
      namespaceId: data.newNamespaceId,
    });

    // insert new mappings
    if (newNamespaceSubgraphs.length > 0) {
      await this.db
        .insert(schema.subgraphsToFederatedGraph)
        .values(
          newNamespaceSubgraphs.map((sg) => ({
            subgraphId: sg.id,
            federatedGraphId: data.federatedGraph.id,
          })),
        )
        .onConflictDoNothing()
        .execute();
    }
  }

  static applyRbacConditionsToQuery(
    rbac: RBACEvaluator | undefined,
    conditions: (SQL<unknown> | undefined)[],
  ): boolean {
    // Apply the IdP gate regardless of RBAC level. Empty allowed-set → no rows.
    if (!applyIdpNamespaceGate(rbac, schema.targets.namespaceId, conditions)) {
      return false;
    }

    if (!rbac || rbac.isOrganizationViewer) {
      return true;
    }

    const graphAdmin = rbac.ruleFor('graph-admin');
    const graphViewer = rbac.ruleFor('graph-viewer');
    if (!graphAdmin && !graphViewer) {
      // The actor doesn't have admin or viewer access to any federated graph
      return false;
    }

    const resources: string[] = [];
    const namespaces: string[] = [];

    if (graphAdmin) {
      resources.push(...graphAdmin.resources);
      namespaces.push(...graphAdmin.namespaces);
    }

    if (graphViewer) {
      resources.push(...graphViewer.resources);
      namespaces.push(...graphViewer.namespaces);
    }

    if (namespaces.length > 0 && resources.length > 0) {
      conditions.push(
        or(inArray(schema.targets.id, [...new Set(namespaces)]), inArray(schema.targets.id, [...new Set(resources)])),
      );
    } else if (namespaces.length > 0) {
      conditions.push(inArray(schema.targets.namespaceId, [...new Set(namespaces)]));
    } else if (resources.length > 0) {
      conditions.push(inArray(schema.targets.id, [...new Set(resources)]));
    }

    return true;
  }

  public async list(opts: FederatedGraphListFilterOptions): Promise<FederatedGraphDTO[]> {
    const conditions: (SQL<unknown> | undefined)[] = [
      eq(schema.targets.type, 'federated'),
      eq(schema.targets.organizationId, this.organizationId),
    ];

    if (opts.namespaceIds && opts.namespaceIds.length > 0) {
      conditions.push(inArray(schema.targets.namespaceId, opts.namespaceIds));
    }

    if (opts.supportsFederation !== undefined) {
      conditions.push(eq(schema.federatedGraphs.supportsFederation, opts.supportsFederation));
    }

    if (!FederatedGraphRepository.applyRbacConditionsToQuery(opts.rbac, conditions)) {
      return [];
    }

    const targetsQuery = this.db
      .select({
        id: schema.targets.id,
        name: schema.targets.name,
      })
      .from(schema.targets)
      .innerJoin(schema.federatedGraphs, eq(schema.federatedGraphs.targetId, schema.targets.id))
      .where(and(...conditions))
      .orderBy(asc(schema.targets.namespaceId));

    if (opts.limit) {
      targetsQuery.limit(opts.limit);
    }

    if (opts.offset) {
      targetsQuery.offset(opts.offset);
    }

    const targets = await targetsQuery.execute();

    const federatedGraphs: FederatedGraphDTO[] = [];

    for (const target of targets) {
      const fg = await this.byTargetId(target.id);
      if (fg === undefined) {
        throw new Error(`Federated Graph ${target.name} not found`);
      }
      federatedGraphs.push(fg);
    }

    return federatedGraphs;
  }

  // Returns count of federated graphs across all namespaces
  public async count(): Promise<number> {
    const result = await this.db
      .select({
        count: sql<number>`cast(count(
        ${targets.id}
        )
        as
        int
        )`,
      })
      .from(schema.targets)
      .where(and(eq(schema.targets.type, 'federated'), eq(schema.targets.organizationId, this.organizationId)))
      .execute();

    return result[0]?.count || 0;
  }

  private async getFederatedGraph(conditions: (SQL<unknown> | undefined)[]): Promise<FederatedGraphDTO | undefined> {
    const resp = await this.db
      .select({
        name: schema.targets.name,
        labelMatchers: schema.targets.labels,
        createdBy: schema.targets.createdBy,
        readme: schema.targets.readme,
        id: schema.federatedGraphs.id,
        routingUrl: schema.federatedGraphs.routingUrl,
        targetId: schema.federatedGraphs.targetId,
        composedSchemaVersionId: schema.federatedGraphs.composedSchemaVersionId,
        namespaceId: schema.namespaces.id,
        namespaceName: schema.namespaces.name,
        admissionWebhookURL: schema.federatedGraphs.admissionWebhookURL,
        admissionWebhookSecret: schema.federatedGraphs.admissionWebhookSecret,
        supportsFederation: schema.federatedGraphs.supportsFederation,
        routerCompatibilityVersion: schema.federatedGraphs.routerCompatibilityVersion,
        organizationId: schema.targets.organizationId,
      })
      .from(targets)
      .where(and(...conditions))
      .innerJoin(schema.federatedGraphs, eq(targets.id, schema.federatedGraphs.targetId))
      .innerJoin(schema.namespaces, eq(schema.namespaces.id, schema.targets.namespaceId));

    if (resp.length === 0) {
      return undefined;
    }

    const latestVersion = await this.db
      .select({
        id: schemaVersion.id,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        compositionId: graphCompositions.id,
        createdAt: schemaVersion.createdAt,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .where(and(eq(schemaVersion.targetId, resp[0].targetId), eq(graphCompositions.isFeatureFlagComposition, false)))
      .orderBy(desc(schemaVersion.createdAt))
      .limit(1)
      .execute();

    const labelMatchers = await this.db.query.targetLabelMatchers.findMany({
      where: eq(schema.targetLabelMatchers.targetId, resp[0].targetId),
    });

    const subgraphs = await this.db.query.subgraphsToFederatedGraph.findMany({
      where: eq(schema.subgraphsToFederatedGraph.federatedGraphId, resp[0].id),
    });

    const contract = await this.db.query.contracts.findFirst({
      where: eq(schema.contracts.downstreamFederatedGraphId, resp[0].id),
    });

    // Composed schema version is not set when the federated graph was not composed.
    return {
      id: resp[0].id,
      name: resp[0].name,
      routingUrl: resp[0].routingUrl,
      isComposable: latestVersion?.[0]?.isComposable ?? false,
      compositionErrors: latestVersion?.[0]?.compositionErrors ?? '',
      lastUpdatedAt: latestVersion?.[0]?.createdAt?.toISOString() ?? '',
      targetId: resp[0].targetId,
      schemaVersionId: resp[0].composedSchemaVersionId ?? undefined,
      subgraphsCount: subgraphs.length ?? 0,
      labelMatchers: labelMatchers.map((s) => s.labelMatcher.join(',')),
      compositionId: latestVersion?.[0]?.compositionId,
      composedSchemaVersionId: resp?.[0]?.composedSchemaVersionId ?? undefined,
      creatorUserId: resp[0].createdBy || undefined,
      readme: resp[0].readme || undefined,
      namespace: resp[0].namespaceName,
      namespaceId: resp[0].namespaceId,
      admissionWebhookURL: resp[0].admissionWebhookURL ?? '',
      admissionWebhookSecret: resp[0].admissionWebhookSecret ?? undefined,
      supportsFederation: resp[0].supportsFederation,
      contract,
      routerCompatibilityVersion: resp[0].routerCompatibilityVersion,
      organizationId: resp[0].organizationId,
    };
  }

  public byTargetId(targetId: string): Promise<FederatedGraphDTO | undefined> {
    return this.getFederatedGraph([
      eq(schema.targets.id, targetId),
      eq(schema.targets.organizationId, this.organizationId),
      eq(schema.targets.type, 'federated'),
    ]);
  }

  public async byId(id: string): Promise<FederatedGraphDTO | undefined> {
    const res = await this.db.query.federatedGraphs.findFirst({
      where: eq(schema.federatedGraphs.id, id),
    });

    if (!res) {
      return undefined;
    }

    return this.byTargetId(res.targetId);
  }

  public async exists(name: string, namespace: string): Promise<boolean> {
    const graphs = await this.db
      .select()
      .from(targets)
      .innerJoin(schema.namespaces, and(eq(schema.namespaces.id, targets.namespaceId)))
      .where(
        and(
          eq(schema.targets.name, name),
          eq(schema.targets.organizationId, this.organizationId),
          eq(schema.targets.type, 'federated'),
          eq(schema.namespaces.name, namespace),
        ),
      );

    return graphs.length === 1;
  }

  public byName(
    name: string,
    namespace: string,
    opts?: {
      supportsFederation?: boolean;
    },
  ): Promise<FederatedGraphDTO | undefined> {
    return this.getFederatedGraph([
      eq(schema.targets.name, name),
      eq(schema.targets.organizationId, this.organizationId),
      eq(schema.targets.type, 'federated'),
      eq(schema.namespaces.name, namespace),
      opts?.supportsFederation === undefined
        ? undefined
        : eq(schema.federatedGraphs.supportsFederation, opts.supportsFederation),
    ]);
  }

  /**
   * bySubgraphLabels returns federated graphs whose label matchers satisfy the given subgraph labels.
   */
  public async bySubgraphLabels(data: {
    labels: Label[];
    namespaceId: string;
    excludeContracts?: boolean;
  }): Promise<FederatedGraphDTO[]> {
    const uniqueLabels = normalizeLabels(data.labels);

    const graphs = await this.db
      .select({
        id: targets.id,
        name: targets.name,
      })
      .from(targets)
      .where(
        and(
          eq(targets.organizationId, this.organizationId),
          eq(targets.type, 'federated'),
          eq(targets.namespaceId, data.namespaceId),
          data.excludeContracts ? isNull(schema.contracts.id) : undefined,
          // In case labels are empty only compose with graphs whose label matchers are also empty.
          // This is a negative lookup. We check if the graph has label matchers and then
          // If there is a label matchers of a federated graph that does not match the given subgraph labels.
          // If all label matchers match, then the federated graph will be part of the result.
          data.labels.length > 0
            ? and(
                exists(this.db.select().from(targetLabelMatchers).where(eq(targetLabelMatchers.targetId, targets.id))),
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
                          arrayOverlaps(
                            targetLabelMatchers.labelMatcher,
                            uniqueLabels.map((ul) => joinLabel(ul)),
                          ),
                        ),
                      ),
                    ),
                ),
              )
            : notExists(this.db.select().from(targetLabelMatchers).where(eq(targetLabelMatchers.targetId, targets.id))),
        ),
      )
      .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targets.id))
      .fullJoin(schema.contracts, eq(schema.contracts.downstreamFederatedGraphId, federatedGraphs.id))
      .leftJoin(schemaVersion, eq(schemaVersion.id, federatedGraphs.composedSchemaVersionId))
      .orderBy(asc(targets.createdAt), asc(schemaVersion.createdAt))
      .execute();

    const graphsDTOs: FederatedGraphDTO[] = [];

    for (const target of graphs) {
      if (!target.id) {
        continue;
      }

      const fg = await this.byTargetId(target.id);
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
    targetId,
    composedSDL,
    clientSchema,
    compositionErrors,
    compositionWarnings,
    composedSubgraphs,
    composedById,
    schemaVersionId,
    isFeatureFlagComposition,
    featureFlagId,
  }: {
    targetId: string;
    schemaVersionId: string;
    composedSDL?: string;
    clientSchema?: string;
    compositionErrors?: Error[];
    compositionWarnings?: Warning[];
    composedSubgraphs: CompositionSubgraphRecord[];
    composedById: string;
    isFeatureFlagComposition: boolean;
    featureFlagId: string;
  }) {
    return this.db.transaction(async (tx) => {
      const compositionRepo = new GraphCompositionRepository(this.logger, tx);
      const [federatedGraph] = await tx
        .select({
          targetId: targets.id,
          id: federatedGraphs.id,
          composedSchemaVersionId: federatedGraphs.composedSchemaVersionId,
          routerCompatibilityVersion: federatedGraphs.routerCompatibilityVersion,
        })
        .from(targets)
        .innerJoin(federatedGraphs, eq(federatedGraphs.targetId, targetId))
        .where(
          and(eq(targets.type, 'federated'), eq(targets.organizationId, this.organizationId), eq(targets.id, targetId)),
        )
        .execute();

      if (federatedGraph === undefined) {
        return undefined;
      }

      let compositionErrorString = '';
      let compositionWarningString = '';

      if (compositionErrors && compositionErrors.length > 0) {
        compositionErrorString = compositionErrors.map((e) => e.toString()).join('\n');
      }

      if (compositionWarnings && compositionWarnings.length > 0) {
        compositionWarningString = compositionWarnings.map((w) => w.toString()).join('\n');
      }

      const insertedVersion = await tx
        .insert(schemaVersion)
        .values({
          id: schemaVersionId,
          organizationId: this.organizationId,
          targetId: federatedGraph.targetId,
          schemaSDL: composedSDL,
          clientSchema,
        })
        .returning({
          insertedId: schemaVersion.id,
        });

      // Always update the federated schema after composing, even if the schema is not composable.
      // That allows us to display the latest schema version in the UI. The router will only fetch
      // the latest composable schema version.
      if (isFeatureFlagComposition) {
        await tx.insert(federatedGraphsToFeatureFlagSchemaVersions).values({
          composedSchemaVersionId: schemaVersionId,
          federatedGraphId: federatedGraph.id,
          baseCompositionSchemaVersionId: federatedGraph.composedSchemaVersionId!,
          featureFlagId,
        });
      } else {
        await tx
          .update(federatedGraphs)
          .set({
            composedSchemaVersionId: insertedVersion[0].insertedId,
          })
          .where(eq(federatedGraphs.id, federatedGraph.id));
      }

      // adding the composition entry and the relation between fedGraph schema version and subgraph schema version
      await compositionRepo.addComposition({
        fedGraphTargetId: federatedGraph.targetId,
        fedGraphSchemaVersionId: insertedVersion[0].insertedId,
        composedSubgraphs,
        compositionErrorString,
        compositionWarningString,
        composedById,
        isFeatureFlagComposition,
        routerCompatibilityVersion: federatedGraph.routerCompatibilityVersion,
      });

      return {
        composedSchemaVersionId: insertedVersion[0].insertedId,
        routerCompatibilityVersion: federatedGraph.routerCompatibilityVersion,
      };
    });
  }

  public async isLatestValidSchemaVersion(targetId: string, schemaVersionId: string): Promise<boolean> {
    const latestValidVersion = await this.db
      .select({
        id: schemaVersion.id,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .where(
        and(
          eq(schemaVersion.targetId, targetId),
          eq(graphCompositions.isFeatureFlagComposition, false),
          and(
            eq(graphCompositions.isComposable, true),
            or(isNull(graphCompositions.deploymentError), eq(graphCompositions.deploymentError, '')),
            or(isNull(graphCompositions.admissionError), eq(graphCompositions.admissionError, '')),
          ),
        ),
      )
      .orderBy(desc(schemaVersion.createdAt))
      .limit(1)
      .execute();

    return latestValidVersion?.[0]?.id === schemaVersionId;
  }

  // returns the latest valid schema version of a federated graph
  public async getLatestValidSchemaVersion(data: { targetId: string }) {
    const latestValidVersion = await this.db
      .select({
        name: targets.name,
        schemaSDL: schemaVersion.schemaSDL,
        clientSchema: schemaVersion.clientSchema,
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
          eq(targets.id, data.targetId),
          eq(graphCompositions.isFeatureFlagComposition, false),
          and(
            eq(graphCompositions.isComposable, true),
            or(isNull(graphCompositions.deploymentError), eq(graphCompositions.deploymentError, '')),
            or(isNull(graphCompositions.admissionError), eq(graphCompositions.admissionError, '')),
          ),
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
      clientSchema: latestValidVersion[0].clientSchema,
      schemaVersionId: latestValidVersion[0].schemaVersionId,
    };
  }

  public async getSchemaVersionById(data: { schemaVersionId: string }) {
    const latestValidVersion = await this.db
      .select({
        schemaSDL: schemaVersion.schemaSDL,
        clientSchema: schemaVersion.clientSchema,
        schemaVersionId: schemaVersion.id,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .innerJoin(targets, eq(schemaVersion.targetId, targets.id))
      .where(
        and(
          eq(targets.organizationId, this.organizationId),
          eq(schemaVersion.id, data.schemaVersionId),
          and(
            eq(graphCompositions.isComposable, true),
            or(isNull(graphCompositions.deploymentError), eq(graphCompositions.deploymentError, '')),
            or(isNull(graphCompositions.admissionError), eq(graphCompositions.admissionError, '')),
          ),
        ),
      )
      .execute();

    if (latestValidVersion.length === 0) {
      return undefined;
    }

    return {
      schema: latestValidVersion[0].schemaSDL,
      clientSchema: latestValidVersion[0].clientSchema,
      schemaVersionId: latestValidVersion[0].schemaVersionId,
    };
  }

  public async getSdlBasedOnSchemaVersion({
    targetId,
    schemaVersionId,
  }: {
    targetId: string;
    schemaVersionId: string;
  }) {
    const version = await this.db
      .select({
        schemaSDL: schemaVersion.schemaSDL,
        clientSchema: schemaVersion.clientSchema,
        schemaVersionId: schemaVersion.id,
      })
      .from(schemaVersion)
      .where(
        and(
          eq(schemaVersion.targetId, targetId),
          eq(schemaVersion.organizationId, this.organizationId),
          eq(schemaVersion.id, schemaVersionId),
        ),
      )
      .execute();

    if (version.length === 0) {
      return undefined;
    }

    return { sdl: version[0].schemaSDL, clientSchema: version[0].clientSchema };
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
    dateRange: DateRange,
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
          composition: {
            columns: {
              id: true,
            },
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
          compositionId: sv.composition?.id ?? '',
        });
      }

      return { federatedGraphChangelog, hasNextPage: entriesAfterCurrentPage.length > 0 };
    });
  }

  public async fetchLatestFederatedGraphChangelog(
    federatedGraphId: string,
  ): Promise<FederatedGraphChangelogDTO | undefined> {
    const compositionRepo = new GraphCompositionRepository(this.logger, this.db);

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

    const changelogs = await this.fetchChangelogByVersion({ schemaVersionId: federatedGraph[0].schemaVersionId });

    if (changelogs.length === 0) {
      return undefined;
    }

    const composition = await compositionRepo.getGraphCompositionBySchemaVersion({
      schemaVersionId: federatedGraph[0].schemaVersionId,
      organizationId: this.organizationId,
    });
    if (!composition) {
      throw new Error(`Could not find composition linked to schema version ${federatedGraph[0].schemaVersionId}`);
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
      compositionId: composition.id,
    };
  }

  public async fetchChangelogByVersion({ schemaVersionId }: { schemaVersionId: string }) {
    const changelogs = await this.db
      .select({
        id: schemaVersionChangeAction.id,
        path: schemaVersionChangeAction.path,
        changeType: schemaVersionChangeAction.changeType,
        changeMessage: schemaVersionChangeAction.changeMessage,
        createdAt: schemaVersionChangeAction.createdAt,
      })
      .from(schemaVersionChangeAction)
      .innerJoin(schemaVersion, eq(schemaVersionChangeAction.schemaVersionId, schemaVersion.id))
      .where(
        and(
          eq(schemaVersionChangeAction.schemaVersionId, schemaVersionId),
          eq(schemaVersion.organizationId, this.organizationId),
        ),
      )
      .execute();

    if (changelogs.length === 0) {
      return [];
    }

    return changelogs.map((c) => ({
      id: c.id,
      path: c.path || '',
      changeType: c.changeType,
      changeMessage: c.changeMessage,
      createdAt: c.createdAt.toString(),
    }));
  }

  public delete(targetID: string) {
    return this.db.delete(targets).where(eq(targets.id, targetID)).execute();
  }

  public async createToken(input: {
    tokenName: string;
    token: string;
    organizationId: string;
    federatedGraphId: string;
    createdBy: string;
  }): Promise<GraphApiKeyDTO> {
    const keys = await this.db
      .insert(graphApiTokens)
      .values({
        name: input.tokenName,
        token: input.token,
        organizationId: input.organizationId,
        federatedGraphId: input.federatedGraphId,
        createdBy: input.createdBy,
      })
      .returning()
      .execute();

    if (keys.length === 0) {
      throw new Error('Failed to create token');
    }

    const userRepo = new UserRepository(this.logger, this.db);
    const user = await userRepo.byId(input.createdBy);

    if (!user) {
      throw new Error('User not found');
    }

    const key = keys[0];

    return {
      id: key.id,
      name: key.name,
      token: key.token,
      createdAt: key.createdAt.toISOString(),
      creatorEmail: user.email,
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
        creatorEmail: users.email,
        token: graphApiTokens.token,
      })
      .from(graphApiTokens)
      .leftJoin(users, eq(users.id, graphApiTokens.createdBy))
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
      creatorEmail: tokens[0].creatorEmail,
    };
  }

  public async getRouterTokens(input: {
    organizationId: string;
    federatedGraphId: string;
    limit: number;
  }): Promise<GraphApiKeyDTO[]> {
    const tokens = await this.db
      .select({
        id: graphApiTokens.id,
        name: graphApiTokens.name,
        createdAt: graphApiTokens.createdAt,
        creatorEmail: users.email,
        token: graphApiTokens.token,
      })
      .from(graphApiTokens)
      .leftJoin(users, eq(users.id, graphApiTokens.createdBy))
      .where(
        and(
          eq(graphApiTokens.organizationId, input.organizationId),
          eq(graphApiTokens.federatedGraphId, input.federatedGraphId),
        ),
      )
      .orderBy(desc(graphApiTokens.createdAt))
      .limit(input.limit)
      .execute();

    return tokens.map((token) => ({
      id: token.id,
      name: token.name,
      createdAt: token.createdAt.toISOString(),
      creatorEmail: token.creatorEmail,
      token: token.token,
    }));
  }

  public async createGraphCryptoKeyPairs(input: {
    organizationId: string;
    federatedGraphId: string;
  }): Promise<RouterRequestKeysDTO> {
    const keys = await generateKeyPair('ES256');

    const privateKey = (keys.privateKey as KeyObject).export({
      format: 'pem',
      type: 'pkcs8',
    });
    const publicKey = (keys.publicKey as KeyObject).export({
      format: 'pem',
      type: 'spki',
    });

    const items = await this.db
      .insert(graphRequestKeys)
      .values({
        privateKey: privateKey.toString(),
        publicKey: publicKey.toString(),
        organizationId: input.organizationId,
        federatedGraphId: input.federatedGraphId,
      })
      .returning()
      .execute();

    if (items.length === 0) {
      throw new Error('Failed to create request keys');
    }

    const key = items[0];

    return {
      id: key.id,
      privateKey: key.privateKey,
      publicKey: key.publicKey,
      createdAt: key.createdAt.toISOString(),
    };
  }

  public async getGraphPublicKey(input: {
    organizationId: string;
    federatedGraphId: string;
  }): Promise<string | undefined> {
    const keys = await this.db
      .select({
        publicKey: graphRequestKeys.publicKey,
      })
      .from(graphRequestKeys)
      .where(
        and(
          eq(graphRequestKeys.organizationId, input.organizationId),
          eq(graphRequestKeys.federatedGraphId, input.federatedGraphId),
        ),
      )
      .limit(1)
      .execute();

    if (keys.length === 0) {
      return undefined;
    }

    return keys[0].publicKey;
  }

  public async getGraphSignedToken(input: {
    organizationId: string;
    federatedGraphId: string;
  }): Promise<string | undefined> {
    const keys = await this.db
      .select({
        privateKey: graphRequestKeys.privateKey,
      })
      .from(graphRequestKeys)
      .where(
        and(
          eq(graphRequestKeys.organizationId, input.organizationId),
          eq(graphRequestKeys.federatedGraphId, input.federatedGraphId),
        ),
      )
      .limit(1)
      .execute();

    if (keys.length === 0) {
      return undefined;
    }

    const ecPrivateKey = await importPKCS8(keys[0].privateKey, 'ES256');

    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .setIssuer(input.organizationId)
      .setAudience(input.federatedGraphId)
      .setExpirationTime('1d')
      .sign(ecPrivateKey);
  }

  public enableFederationSupport({ targetId }: { targetId: string }) {
    return this.db.transaction(async (tx) => {
      const subgraphRepo = new SubgraphRepository(this.logger, tx, this.organizationId);
      const fedGraphRepo = new FederatedGraphRepository(this.logger, tx, this.organizationId);
      const contractRepo = new ContractRepository(this.logger, tx, this.organizationId);

      const subgraphs = await subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: targetId,
      });

      const graph = await fedGraphRepo.byTargetId(targetId);
      if (!graph) {
        throw new Error('Monograph not found');
      }

      const contracts = await contractRepo.bySourceFederatedGraphId(graph.id);

      const graphAndContracts = [graph, ...contracts.map((c) => c.downstreamFederatedGraph)];

      await tx
        .update(federatedGraphs)
        .set({
          supportsFederation: true,
        })
        .where(
          inArray(
            federatedGraphs.targetId,
            graphAndContracts.map((g) => g.targetId),
          ),
        );

      const newLabel: Label = {
        key: 'federated',
        value: uid(6),
      };

      await tx.delete(schema.targetLabelMatchers).where(
        inArray(
          schema.targetLabelMatchers.targetId,
          graphAndContracts.map((g) => g.targetId),
        ),
      );

      await tx
        .insert(schema.targetLabelMatchers)
        .values(
          graphAndContracts.map((g) => ({
            targetId: g.targetId,
            labelMatcher: [joinLabel(newLabel)],
          })),
        )
        .execute();

      if (subgraphs.length > 0) {
        await tx
          .update(targets)
          .set({
            labels: [joinLabel(newLabel)],
          })
          .where(eq(targets.id, subgraphs[0].targetId));
      }
    });
  }

  public updateRouterCompatibilityVersion(id: string, version: string) {
    return this.db
      .update(federatedGraphs)
      .set({ routerCompatibilityVersion: version })
      .where(eq(federatedGraphs.id, id))
      .execute();
  }
}
