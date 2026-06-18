import { PlainMessage } from '../../../types/index.js';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  PublishFederatedSubgraphsRequest,
  PublishFederatedSubgraphsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { FastifyBaseLogger } from 'fastify';
import * as Sentry from '@sentry/node';
import { maxRowLimitForChecks } from '../../constants.js';
import { buildSchema } from '../../composition/composition.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository, UpdateSubgraphSchemaData } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import type { AuthContext, FederatedGraphDTO, SubgraphDTO } from '../../../types/index.js';
import {
  clamp,
  enrichLogger,
  getFederatedGraphRouterCompatibilityVersion,
  getLogger,
  handleError,
} from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { CompositionService } from '../../services/CompositionService.js';
import { withSpan } from '../../tracing.js';
import { BatchPublishJobDetailsRepository } from '../../repositories/BatchPublishJobDetailsRepository.js';

/**
 * PublishFederatedSubgraphs publishes the schemas of multiple existing subgraphs (and feature subgraphs) in a single
 * request. Every subgraph must already exist. All schema versions are written first; then the union of affected
 * federated graphs (and their contracts / feature flags) is composed exactly once each, rather than once per
 * subgraph. This dramatically reduces the number of compositions when publishing many subgraphs at once.
 */
export function publishFederatedSubgraphs(
  opts: RouterOptions,
  req: PublishFederatedSubgraphsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PublishFederatedSubgraphsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PublishFederatedSubgraphsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    // A single list of subgraphs to publish. Regular subgraphs and feature subgraphs share a namespace and cannot
    // have the same name, so the kind of each entry is resolved from the database rather than from the request.
    const requestedEntries = req.subgraphs;

    if (requestedEntries.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `At least one subgraph or feature subgraph must be provided.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    // Reject duplicate names within the request to avoid ambiguous, non-deterministic writes.
    const seenNames = new Set<string>();
    const duplicateNames = new Set<string>();
    for (const entry of requestedEntries) {
      if (seenNames.has(entry.name)) {
        duplicateNames.add(entry.name);
      }
      seenNames.add(entry.name);
    }
    if (duplicateNames.size > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The following subgraphs were provided more than once: ${[...duplicateNames].join(', ')}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    // Resolve every requested subgraph; all of them must already exist.
    const resolved: { subgraph: SubgraphDTO; schema: string }[] = [];
    const typeErrors: string[] = [];
    for (const subgraph of await subgraphRepo.getSubgraphsByNames(
      requestedEntries.map((e) => e.name),
      namespace.id,
    )) {
      if (subgraph.type === 'grpc_plugin') {
        typeErrors.push(
          `Subgraph "${subgraph.name}" is a plugin. Please use the 'wgc router plugin publish' command to publish it.`,
        );
        continue;
      }
      if (subgraph.type === 'grpc_service') {
        typeErrors.push(
          `Subgraph "${subgraph.name}" is a grpc service. Please use the 'wgc grpc-service publish' command to publish it.`,
        );
        continue;
      }

      const schema = requestedEntries
        .find((re) => re.name.toLowerCase() === subgraph.name.toLowerCase())!
        .schema.trimEnd();

      resolved.push({ subgraph, schema });
    }

    const resolvedSubgraphNames = new Set(resolved.map((re) => re.subgraph.name));
    const requestedSubgraphNames = new Set(requestedEntries.map((re) => re.name));
    const notFoundSubgraphNames = [...requestedSubgraphNames.difference(resolvedSubgraphNames)];

    if (notFoundSubgraphNames.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The following subgraphs do not exist in the namespace "${req.namespace}": ${notFoundSubgraphNames.join(', ')}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    if (typeErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: typeErrors.join('\n'),
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    withSpan('RBACEvaluator.hasSubGraphWriteAccess', () => {
      for (const { subgraph } of resolved) {
        if (!authContext.rbac.hasSubGraphWriteAccess(subgraph)) {
          throw new UnauthorizedError();
        }
      }
    });

    // Validate every schema as a subgraph SDL before writing anything.
    const schemaErrors: string[] = [];
    const items: (UpdateSubgraphSchemaData & { name: string })[] = [];

    /**
     * @TODO:
     *
     * As of 2026-06-10 we only support v1, so instead of loading the federated graphs just to get that value we are
     * going to pass no federated graphs to this method which will return the latest supported version. In the future,
     * when we support different versions, we need to revisit this.
     */
    const routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion([]);
    for (const { subgraph, schema } of resolved) {
      let isEventDrivenGraph = false;
      let isV2Graph: boolean | undefined;
      try {
        const result = buildSchema(schema, true, routerCompatibilityVersion);
        if (!result.success) {
          schemaErrors.push(`Subgraph "${subgraph.name}": ${result.errors.map((e) => e.toString()).join('; ')}`);
          continue;
        }
        isEventDrivenGraph = result.isEventDrivenGraph || false;
        isV2Graph = result.isVersionTwo;
      } catch (e: any) {
        schemaErrors.push(`Subgraph "${subgraph.name}": ${e.message}`);
        continue;
      }

      // The subgraph already exists, so the stored EDG flag is the source of truth.
      if (subgraph.isEventDrivenGraph !== isEventDrivenGraph) {
        schemaErrors.push(
          subgraph.isEventDrivenGraph
            ? `Subgraph "${subgraph.name}" was originally created as an Event-Driven Graph (EDG) and cannot be published with a regular subgraph schema.`
            : `Subgraph "${subgraph.name}" was originally created as a regular subgraph and cannot be published with an Event-Driven Graph (EDG) schema.`,
        );
        continue;
      }

      items.push({
        name: subgraph.name,
        targetId: subgraph.targetId,
        labels: subgraph.labels,
        unsetLabels: false,
        schemaSDL: schema,
        updatedBy: authContext.userId,
        namespaceId: namespace.id,
        isV2Graph,
        subgraph,
      });
    }

    if (schemaErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
          details: schemaErrors.join('\n'),
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    const runBatchPublishParams: RunBatchPublishParams = {
      opts,
      logger,
      authContext,
      disableResolvabilityValidation: req.disableResolvabilityValidation,
      items,
    };

    if (req.async) {
      const jobRepo = new BatchPublishJobDetailsRepository(opts.db, opts.lockAdapter, authContext.organizationId);
      const jobId = await jobRepo.create();
      try {
        await opts.queues.deleteBatchPublishJobDetailsQueue.addJob({
          jobId,
          organizationId: authContext.organizationId,
        });
      } catch (err) {
        await jobRepo.delete(jobId);
        logger.error(err, 'Failed to add job to delete batch publish job details queue');

        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Failed to add job to delete batch publish job details queue',
          },
          deploymentErrors: [],
          compositionErrors: [],
          compositionWarnings: [],
          counts: {
            compositionErrors: 0,
            compositionWarnings: 0,
            deploymentErrors: 0,
          },
          updatedSubgraphNames: [],
        };
      }

      Sentry.startSpan(
        {
          name: 'PublishFederatedSubgraphs.runBatchPublish',
          parentSpan: Sentry.getActiveSpan(),
          attributes: {
            jobId,
            actorId: authContext.userId,
            organizationId: authContext.organizationId,
            namespace: namespace.name,
            numberOfItems: items.length,
          },
        },
        async () => {
          try {
            const result = await jobRepo.withNamespaceLock(namespace.id, async () => {
              await jobRepo.update(jobId, { status: 'processing' });
              return runBatchPublish({ ...runBatchPublishParams, shouldRefreshSubgraphs: true });
            });

            await jobRepo.update(jobId, {
              status: 'completed',
              compositionResult: {
                deploymentErrors: result.deploymentErrors,
                compositionWarnings: result.compositionWarnings,
                compositionErrors: result.compositionErrors,
                updatedSubgraphNames: result.changedSubgraphNames,
              },
            });
          } catch (err) {
            Sentry.captureException(err);
            await jobRepo.update(jobId, {
              status: 'failed',
              failureReason: err instanceof Error ? err.message : null,
            });
          } finally {
            await Sentry.flush(2000);
          }
        },
      );

      return {
        response: { code: EnumStatusCode.OK },
        deploymentErrors: [],
        compositionErrors: [],
        compositionWarnings: [],
        counts: {
          compositionErrors: 0,
          compositionWarnings: 0,
          deploymentErrors: 0,
        },
        updatedSubgraphNames: [],
        jobId,
      };
    }

    const boundedLimit = req.limit === undefined ? maxRowLimitForChecks : clamp(req.limit, 1, maxRowLimitForChecks);
    const { deploymentErrors, compositionErrors, compositionWarnings, changedSubgraphNames } =
      await runBatchPublish(runBatchPublishParams);

    const counts = {
      compositionErrors: compositionErrors.length,
      compositionWarnings: compositionWarnings.length,
      deploymentErrors: deploymentErrors.length,
    };

    return {
      response: {
        code:
          compositionErrors.length > 0
            ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
            : deploymentErrors.length > 0
              ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
              : EnumStatusCode.OK,
      },
      deploymentErrors: deploymentErrors.slice(0, boundedLimit),
      compositionErrors: compositionErrors.slice(0, boundedLimit),
      compositionWarnings: compositionWarnings.slice(0, boundedLimit),
      counts,
      updatedSubgraphNames: changedSubgraphNames,
    };
  });
}

type RunBatchPublishParams = {
  opts: RouterOptions;
  logger: FastifyBaseLogger;
  authContext: AuthContext;
  disableResolvabilityValidation: boolean | undefined;
  items: (UpdateSubgraphSchemaData & { name: string })[];
  shouldRefreshSubgraphs?: boolean;
};

async function runBatchPublish({
  opts,
  logger,
  authContext,
  disableResolvabilityValidation,
  items,
  shouldRefreshSubgraphs,
}: RunBatchPublishParams) {
  const auditLogRepo = new AuditLogRepository(opts.db);
  const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
  const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
  const orgWebhooks = new OrganizationWebhookService(
    opts.db,
    authContext.organizationId,
    opts.logger,
    opts.billingDefaultPlanId,
    opts.webhookProxyUrl,
  );

  if (shouldRefreshSubgraphs) {
    /**
     * Because the subgraphs can be updated by a job that started before this one, we need to ensure that we
     * have the latest version of the subgraph before running the composition
     */
    const updatedSubgraphs = await subgraphRepo.getSubgraphsByTargetIds(
      items.filter((item) => item.subgraph).map((item) => item.subgraph!.targetId),
    );

    for (const currentItem of items) {
      if (!currentItem.subgraph) {
        continue;
      }

      const updatedSubgraph = updatedSubgraphs.find((subgraph) => subgraph.targetId === currentItem.subgraph?.targetId);
      if (!updatedSubgraph) {
        throw new Error(`Updated subgraph "${currentItem.subgraph.name}" not found`);
      }

      currentItem.subgraph = updatedSubgraph;
      currentItem.labels = updatedSubgraph.labels;
    }
  }

  /**
   * Phase 1: persist all schema versions and collect the deduplicated union of affected graphs/flags in a single
   * short transaction.
   */
  const { affectedFederatedGraphs, affectedFeatureFlags, changedSubgraphNames } =
    await subgraphRepo.batchWriteAndCollect(items);

  /**
   * Phase 2: compose and deploy the affected graphs OUTSIDE the transaction. Composition is long-running (worker
   * composition, blob uploads, admission webhooks); holding a DB transaction open across it — for the whole batch —
   * would tie up a connection and risk timeouts and lock contention.
   *
   * This comment is true only for when we are not using async composition as to guarantee that the compositions are
   * processed in the correct order, we need to have a transaction lock.
   */
  const compositionService = new CompositionService(
    opts.db,
    authContext.organizationId,
    logger,
    { cdnBaseUrl: opts.cdnBaseUrl, webhookJWTSecret: opts.admissionWebhookJWTSecret },
    opts.blobStorage,
    opts.chClient,
    opts.webhookProxyUrl,
    disableResolvabilityValidation,
  );

  const { compositionErrors, compositionWarnings, deploymentErrors } =
    await compositionService.recomposeAndDeployAffected({
      actorId: authContext.userId,
      affectedFederatedGraphs,
      affectedFeatureFlags,
      isFeatureSubgraph: false,
    });

  // Re-fetch the affected federated graphs to pick up the updated composedSchemaVersionId for the webhook payloads.
  const updatedFederatedGraphs = (
    await Promise.all(affectedFederatedGraphs.map((graph) => fedGraphRepo.byId(graph.id)))
  ).filter((graph): graph is FederatedGraphDTO => graph !== undefined);

  // Send a schema-updated webhook for each federated graph that was recomposed.
  for (const graph of updatedFederatedGraphs) {
    const hasErrors =
      compositionErrors.some((error) => error.federatedGraphName === graph.name) ||
      deploymentErrors.some((error) => error.federatedGraphName === graph.name);
    orgWebhooks.send(
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        payload: {
          federated_graph: {
            id: graph.id,
            name: graph.name,
            namespace: graph.namespace,
            composedSchemaVersionId: graph.composedSchemaVersionId,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          errors: hasErrors,
          actor_id: authContext.userId,
        },
      },
      authContext.userId,
    );
  }

  // Audit log per subgraph that actually changed.
  const changedSet = new Set(changedSubgraphNames);
  for (const { subgraph } of items) {
    if (!subgraph || !changedSet.has(subgraph.name)) {
      continue;
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: subgraph.isFeatureSubgraph ? 'feature_subgraph.updated' : 'subgraph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: subgraph.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
      auditableDisplayName: subgraph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: subgraph.namespaceId,
      targetNamespaceDisplayName: subgraph.namespace,
    });
  }

  return {
    deploymentErrors,
    compositionErrors,
    compositionWarnings,
    changedSubgraphNames,
  };
}
