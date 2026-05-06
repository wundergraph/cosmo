import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  BulkUpdateProposalRolloutPercentagesRequest,
  BulkUpdateProposalRolloutPercentagesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as schema from '../../../db/schema.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

// BulkUpdateProposalRolloutPercentages atomically creates or updates rollout
// percentages across one or more proposals on the same federated graph.
//
// For proposals that already have a linked rollout flag, only traffic_percentage
// is updated. For proposals without one, the handler:
//   1. Verifies the proposal is in APPROVED state.
//   2. Ensures a feature subgraph exists per modified proposal subgraph
//      (name: <proposalName>__<subgraphName>__rollout, same routingUrl as the
//      base subgraph since proposals carry SDL-level cache directive tweaks
//      only — runtime URL is identical).
//   3. Publishes the proposal's SDL onto each feature subgraph.
//   4. Creates a feature flag wrapping those subgraphs and links it back to
//      the proposal via feature_flags.proposal_id.
//
// Why bulk: the router fails closed and disables the entire rollout selector
// when cumulative traffic_percentage > 100 across all FFs (see
// router/core/feature_flag_rollout.go). Editing siblings in N separate calls
// would: (a) leave the system in an over-100 state between calls, briefly
// dropping every rollout's traffic to base, and (b) trigger N
// composeAndDeployGraphs invocations = N CDN pushes = N router config reloads.
// Doing it in one call gives an atomic budget enforcement and a single
// router-visible config change.
export function bulkUpdateProposalRolloutPercentages(
  opts: RouterOptions,
  req: BulkUpdateProposalRolloutPercentagesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<BulkUpdateProposalRolloutPercentagesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<BulkUpdateProposalRolloutPercentagesResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (req.items.length === 0) {
      return { response: { code: EnumStatusCode.OK }, items: [] };
    }

    // Per-item validation. Cumulative validation happens after we resolve the
    // batch's federated graph and pull sibling FFs not in the batch.
    for (const item of req.items) {
      if (item.percentage > 100) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `percentage must be in [0, 100], got ${item.percentage} for proposalId=${item.proposalId}`,
          },
          items: [],
        };
      }
    }

    // Reject duplicate proposalIds in one batch — silently merging would let
    // the caller send {pid:p, pct:10} + {pid:p, pct:90} and observe whichever
    // happens to land last; loud failure is the right default.
    const seen = new Set<string>();
    for (const item of req.items) {
      if (seen.has(item.proposalId)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `duplicate proposalId in batch: ${item.proposalId}`,
          },
          items: [],
        };
      }
      seen.add(item.proposalId);
    }

    const proposalRepo = new ProposalRepository(opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    // Resolve every proposal. Where a linked rollout flag already exists, we
    // record it for the percentage-update path. Where it doesn't, we deploy
    // (create feature subgraphs + flag) and record the freshly-created link.
    type Resolved = {
      proposalId: string;
      federatedGraphId: string;
      featureFlagId: string;
      featureFlagName: string;
      newPercentage: number;
      isNew: boolean;
    };
    const resolved: Resolved[] = [];

    for (const item of req.items) {
      const proposal = await proposalRepo.ById(item.proposalId);
      if (!proposal) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Proposal ${item.proposalId} not found`,
          },
          items: [],
        };
      }

      const linked = await proposalRepo.getLinkedRolloutFlag(item.proposalId);
      if (linked) {
        resolved.push({
          proposalId: item.proposalId,
          federatedGraphId: proposal.proposal.federatedGraphId,
          featureFlagId: linked.id,
          featureFlagName: linked.name,
          newPercentage: item.percentage,
          isNew: false,
        });
        continue;
      }

      // Deploy path: proposal has no rollout flag yet, create one.
      if (proposal.proposal.state !== 'APPROVED') {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details:
              `Proposal ${item.proposalId} must be in APPROVED state to deploy a rollout ` +
              `(got ${proposal.proposal.state})`,
          },
          items: [],
        };
      }

      const federatedGraph = await fedGraphRepo.byId(proposal.proposal.federatedGraphId);
      if (!federatedGraph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Federated graph for proposal ${item.proposalId} not found`,
          },
          items: [],
        };
      }

      const featureSubgraphIds: string[] = [];
      for (const ps of proposal.proposalSubgraphs) {
        if (ps.isDeleted) {
          // Caching proposals shouldn't include deletions, but skip for safety.
          continue;
        }
        const baseSubgraph = await subgraphRepo.byName(ps.subgraphName, federatedGraph.namespace);
        if (!baseSubgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Base subgraph "${ps.subgraphName}" not found in namespace "${federatedGraph.namespace}"`,
            },
            items: [],
          };
        }

        const featureSubgraphName = `${proposal.proposal.name}__${ps.subgraphName}__rollout`;
        let featureSubgraph = await subgraphRepo.byName(featureSubgraphName, federatedGraph.namespace);
        if (!featureSubgraph) {
          featureSubgraph = await subgraphRepo.create({
            name: featureSubgraphName,
            namespace: federatedGraph.namespace,
            namespaceId: federatedGraph.namespaceId,
            createdBy: authContext.userId,
            labels: baseSubgraph.labels,
            routingUrl: baseSubgraph.routingUrl,
            isEventDrivenGraph: false,
            subscriptionUrl: baseSubgraph.subscriptionUrl,
            subscriptionProtocol: baseSubgraph.subscriptionProtocol,
            websocketSubprotocol: baseSubgraph.websocketSubprotocol,
            featureSubgraphOptions: {
              isFeatureSubgraph: true,
              baseSubgraphID: baseSubgraph.id,
            },
            type: 'standard',
          });
          if (!featureSubgraph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Failed to create feature subgraph "${featureSubgraphName}"`,
              },
              items: [],
            };
          }
        }

        // Publish the proposal's SDL onto the feature subgraph so the rollout
        // routes through the cache-tuned schema while the URL stays identical.
        await subgraphRepo.addSchemaVersion({
          targetId: featureSubgraph.targetId,
          subgraphSchema: ps.schemaSDL,
        });

        featureSubgraphIds.push(featureSubgraph.id);
      }

      if (featureSubgraphIds.length === 0) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Proposal ${item.proposalId} has no modified subgraphs to deploy as a rollout`,
          },
          items: [],
        };
      }

      const featureFlagName = `proposal_${item.proposalId.slice(0, 8)}_rollout`;
      const featureFlag = await featureFlagRepo.createFeatureFlag({
        namespaceId: federatedGraph.namespaceId,
        name: featureFlagName,
        labels: federatedGraph.labelMatchers.flatMap((m) =>
          m.split(',').map((l) => ({ key: l.split('=')[0], value: l.split('=')[1] || '' })),
        ),
        featureSubgraphIds,
        createdBy: authContext.userId,
        isEnabled: true,
      });

      await proposalRepo.setLinkedRolloutFlag({
        featureFlagId: featureFlag.id,
        proposalId: item.proposalId,
        trafficPercentage: item.percentage,
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'feature_flag.created',
        action: 'created',
        actorId: authContext.userId,
        auditableType: 'feature_flag',
        auditableDisplayName: featureFlag.name,
        apiKeyName: authContext.apiKeyName,
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: federatedGraph.namespaceId,
        targetNamespaceDisplayName: federatedGraph.namespace,
      });

      resolved.push({
        proposalId: item.proposalId,
        federatedGraphId: proposal.proposal.federatedGraphId,
        featureFlagId: featureFlag.id,
        featureFlagName: featureFlag.name,
        newPercentage: item.percentage,
        isNew: true,
      });
    }

    // The batch must target one federated graph: composeAndDeployGraphs runs
    // per federated graph, so a multi-graph batch defeats the "one push" goal.
    // Caller can split into per-graph batches if they really need to.
    const graphIds = [...new Set(resolved.map((r) => r.federatedGraphId))];
    if (graphIds.length > 1) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Bulk update spans multiple federated graphs (${graphIds.join(', ')}); split into per-graph batches`,
        },
        items: [],
      };
    }
    const federatedGraphId = graphIds[0]!;

    // Cumulative budget check: sum of (a) the new pct for every FF in the
    // batch + (b) current pct for every other FF on this federated graph
    // that's an active rollout (proposalId set, traffic_percentage set) and
    // not in this batch. Mirrors what the router computes at config-load.
    const allActiveFFs = await opts.db
      .select({
        id: schema.featureFlags.id,
        trafficPercentage: schema.featureFlags.trafficPercentage,
      })
      .from(schema.featureFlags)
      .innerJoin(schema.proposals, eq(schema.featureFlags.proposalId, schema.proposals.id))
      .where(
        and(
          eq(schema.proposals.federatedGraphId, federatedGraphId),
          isNotNull(schema.featureFlags.trafficPercentage),
        ),
      );

    const inBatch = new Set(resolved.map((r) => r.featureFlagId));
    let cumulative = 0;
    for (const r of resolved) {
      cumulative += r.newPercentage;
    }
    for (const ff of allActiveFFs) {
      if (inBatch.has(ff.id)) {
        continue;
      }
      cumulative += ff.trafficPercentage ?? 0;
    }
    if (cumulative > 100) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            `Cumulative rollout percentage across all active rollouts on this federated graph ` +
            `would be ${cumulative}, exceeding 100. The router fails closed at >100 (all unpinned ` +
            `traffic falls back to base). Reduce the requested percentages or teardown another rollout first.`,
        },
        items: [],
      };
    }

    // Single transaction: every FF row updated together. Newly-deployed flags
    // had setLinkedRolloutFlag set the percentage already, but we still update
    // here for consistency (idempotent same-value write).
    await opts.db.transaction(async (tx) => {
      for (const r of resolved) {
        await tx
          .update(schema.featureFlags)
          .set({ trafficPercentage: r.newPercentage, updatedAt: new Date() })
          .where(eq(schema.featureFlags.id, r.featureFlagId));
      }
    });

    // Single composeAndDeployGraphs call → single CDN push → single router
    // config reload. This is the whole point of the bulk endpoint.
    const federatedGraph = await fedGraphRepo.byId(federatedGraphId);
    if (federatedGraph) {
      const { compositionErrors } = await fedGraphRepo.composeAndDeployGraphs({
        actorId: authContext.userId,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        blobStorage: opts.blobStorage,
        chClient: opts.chClient!,
        compositionOptions: {},
        federatedGraphs: [federatedGraph],
        webhookProxyUrl: opts.webhookProxyUrl,
      });
      const ffNamesInBatch = new Set(resolved.map((r) => r.featureFlagName));
      const relevantErrors = compositionErrors.filter((e) => ffNamesInBatch.has(e.featureFlag));
      if (relevantErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details:
              `One or more rollout feature flags failed to compose at the new percentages. ` +
              `The router will keep falling back to base for those flags until fixed.\n` +
              relevantErrors.map((e) => `${e.featureFlag}: ${e.message}`).join('\n'),
          },
          items: [],
        };
      }
    }

    return {
      response: { code: EnumStatusCode.OK },
      items: resolved.map((r) => ({
        proposalId: r.proposalId,
        percentage: r.newPercentage,
      })),
    };
  });
}
