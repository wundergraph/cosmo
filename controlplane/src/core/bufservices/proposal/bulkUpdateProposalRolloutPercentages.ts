import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  BulkUpdateProposalRolloutPercentagesRequest,
  BulkUpdateProposalRolloutPercentagesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as schema from '../../../db/schema.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

// Cap to prevent a single request from holding a long transaction and amplifying
// CDN pushes. Caller must split into smaller batches if they have more.
const MAX_BATCH_ITEMS = 50;

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

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (req.items.length === 0) {
      return { response: { code: EnumStatusCode.OK }, items: [] };
    }

    if (req.items.length > MAX_BATCH_ITEMS) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Too many items in batch: got ${req.items.length}, max is ${MAX_BATCH_ITEMS}. Split into smaller per-graph batches.`,
        },
        items: [],
      };
    }

    // Per-item input validation. Cumulative budget is checked later inside the
    // transaction once we hold row locks on the federated graph's FFs.
    for (const item of req.items) {
      if (!Number.isInteger(item.percentage) || item.percentage < 0 || item.percentage > 100) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `percentage must be an integer in [0, 100], got ${item.percentage} for proposalId=${item.proposalId}`,
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

    // -------- Phase 1: read-only resolve --------
    // Load every proposal and discover the single federated graph the batch
    // targets. No mutations happen here; if anything is missing/invalid we
    // return ERR before touching the DB.
    const proposalRepo = new ProposalRepository(opts.db, authContext.organizationId);

    type ProposalPlan = {
      proposalId: string;
      proposalName: string;
      proposalState: string;
      federatedGraphId: string;
      // Linked FF row, if a rollout was previously deployed for this proposal.
      linkedFlag: { id: string; name: string; trafficPercentage: number | null } | undefined;
      // Subgraphs to deploy as feature subgraphs (only used when linkedFlag is undefined).
      proposalSubgraphs: { subgraphName: string; schemaSDL: string; isDeleted: boolean }[];
      newPercentage: number;
    };
    const plans: ProposalPlan[] = [];

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
      const linkedFlag = await proposalRepo.getLinkedRolloutFlag(item.proposalId);

      // First-deploy gate: state must be APPROVED. Re-deploys (linked flag
      // already exists) are allowed in any state; the typical use is to dial
      // the percentage up/down between APPROVED and PUBLISHED.
      if (!linkedFlag && proposal.proposal.state !== 'APPROVED') {
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

      plans.push({
        proposalId: item.proposalId,
        proposalName: proposal.proposal.name,
        proposalState: proposal.proposal.state,
        federatedGraphId: proposal.proposal.federatedGraphId,
        linkedFlag,
        proposalSubgraphs: proposal.proposalSubgraphs.map((ps) => ({
          subgraphName: ps.subgraphName,
          schemaSDL: ps.schemaSDL,
          isDeleted: ps.isDeleted,
        })),
        newPercentage: item.percentage,
      });
    }

    // The batch must target one federated graph: composeAndDeployGraphs runs
    // per federated graph, so a multi-graph batch defeats the "one push" goal.
    const graphIds = [...new Set(plans.map((p) => p.federatedGraphId))];
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

    const fedGraphRepoRO = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedGraphRepoRO.byId(federatedGraphId);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph for proposal batch not found`,
        },
        items: [],
      };
    }

    // -------- Phase 2: authorization --------
    if (!authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const namespace = await namespaceRepo.byId(federatedGraph.namespaceId);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace ${federatedGraph.namespace} not found`,
        },
        items: [],
      };
    }
    if (!namespace.enableProposals) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Proposals are not enabled for namespace ${federatedGraph.namespace}`,
        },
        items: [],
      };
    }

    // Pre-compute label list once. labelMatchers is a list of strings of the
    // form "k1=v1,k2=v2"; splitLabel handles escapes and edge cases the
    // straightforward `split('=')` approach gets wrong.
    const fedGraphLabels = federatedGraph.labelMatchers.flatMap((m) => m.split(',').map((l) => splitLabel(l)));

    // -------- Phase 3: transactional deploy + budget + update + compose --------
    type ResolvedItem = {
      proposalId: string;
      featureFlagId: string;
      featureFlagName: string;
      newPercentage: number;
    };
    const resolved: ResolvedItem[] = [];
    const compositionFailures: { featureFlag: string; message: string }[] = [];

    try {
      await opts.db.transaction(async (tx) => {
        const txProposalRepo = new ProposalRepository(tx, authContext.organizationId);
        const txFedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
        const txSubgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
        const txFeatureFlagRepo = new FeatureFlagRepository(logger, tx, authContext.organizationId);
        const txAuditLogRepo = new AuditLogRepository(tx);

        // Lock every active rollout flag on this federated graph for the
        // duration of the transaction. Two concurrent bulkUpdate calls on the
        // same graph now serialize through these locks, so the cumulative budget
        // check can't be bypassed by interleaving reads.
        await tx
          .select({ id: schema.featureFlags.id })
          .from(schema.featureFlags)
          .innerJoin(schema.proposals, eq(schema.featureFlags.proposalId, schema.proposals.id))
          .where(
            and(
              eq(schema.proposals.federatedGraphId, federatedGraphId),
              isNotNull(schema.featureFlags.trafficPercentage),
            ),
          )
          .for('update', { of: schema.featureFlags });

        // Deploy fan-out for any plan without a linked flag yet.
        for (const plan of plans) {
          if (plan.linkedFlag) {
            resolved.push({
              proposalId: plan.proposalId,
              featureFlagId: plan.linkedFlag.id,
              featureFlagName: plan.linkedFlag.name,
              newPercentage: plan.newPercentage,
            });
            continue;
          }

          const featureSubgraphIds: string[] = [];
          for (const ps of plan.proposalSubgraphs) {
            if (ps.isDeleted) {
              // Caching proposals shouldn't include deletions, but skip for safety.
              continue;
            }
            const baseSubgraph = await txSubgraphRepo.byName(ps.subgraphName, federatedGraph.namespace);
            if (!baseSubgraph) {
              throw new BulkRolloutError(
                EnumStatusCode.ERR_NOT_FOUND,
                `Base subgraph "${ps.subgraphName}" not found in namespace "${federatedGraph.namespace}"`,
              );
            }

            const featureSubgraphName = `${plan.proposalName}__${ps.subgraphName}__rollout`;
            let featureSubgraph = await txSubgraphRepo.byName(featureSubgraphName, federatedGraph.namespace);
            if (!featureSubgraph) {
              featureSubgraph = await txSubgraphRepo.create({
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
                throw new BulkRolloutError(
                  EnumStatusCode.ERR,
                  `Failed to create feature subgraph "${featureSubgraphName}"`,
                );
              }
            }

            // Publish the proposal's SDL onto the feature subgraph so the rollout
            // routes through the cache-tuned schema while the URL stays identical.
            await txSubgraphRepo.addSchemaVersion({
              targetId: featureSubgraph.targetId,
              subgraphSchema: ps.schemaSDL,
            });

            featureSubgraphIds.push(featureSubgraph.id);
          }

          if (featureSubgraphIds.length === 0) {
            throw new BulkRolloutError(
              EnumStatusCode.ERR,
              `Proposal ${plan.proposalId} has no modified subgraphs to deploy as a rollout`,
            );
          }

          // Use the full proposalId rather than an 8-char prefix to keep the
          // collision probability negligible across the lifetime of an org.
          const featureFlagName = `proposal_${plan.proposalId}_rollout`;
          const featureFlag = await txFeatureFlagRepo.createFeatureFlag({
            namespaceId: federatedGraph.namespaceId,
            name: featureFlagName,
            labels: fedGraphLabels,
            featureSubgraphIds,
            createdBy: authContext.userId,
            isEnabled: true,
          });

          await txProposalRepo.setLinkedRolloutFlag({
            featureFlagId: featureFlag.id,
            proposalId: plan.proposalId,
            trafficPercentage: plan.newPercentage,
          });

          await txAuditLogRepo.addAuditLog({
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
            proposalId: plan.proposalId,
            featureFlagId: featureFlag.id,
            featureFlagName: featureFlag.name,
            newPercentage: plan.newPercentage,
          });
        }

        // Cumulative budget check: sum of (a) the new pct for every FF in the
        // batch + (b) current pct for every other FF on this federated graph
        // that's an active rollout (proposalId set, traffic_percentage set) and
        // not in this batch. Mirrors what the router computes at config-load.
        // Read happens within the locked range (FOR UPDATE above), so concurrent
        // bulkUpdates can't slip in additional pct between read and write.
        const allActiveFFs = await tx
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
          throw new BulkRolloutError(
            EnumStatusCode.ERR,
            `Cumulative rollout percentage across all active rollouts on this federated graph ` +
              `would be ${cumulative}, exceeding 100. The router fails closed at >100 (all unpinned ` +
              `traffic falls back to base). Reduce the requested percentages or teardown another rollout first.`,
          );
        }

        // Update every FF row in one go. Newly-deployed flags had
        // setLinkedRolloutFlag set the percentage already, but we still update
        // here for consistency (idempotent same-value write). For pre-existing
        // flags (the percentage-only path), this is the only write that touches
        // traffic_percentage.
        for (const r of resolved) {
          await tx
            .update(schema.featureFlags)
            .set({ trafficPercentage: r.newPercentage, updatedAt: new Date() })
            .where(eq(schema.featureFlags.id, r.featureFlagId));

          // Audit the percentage-only update path so forensic queries can answer
          // "who changed prod traffic from 5% to 95%". The new-FF path already
          // emits a feature_flag.created log above.
          const planForR = plans.find((p) => p.proposalId === r.proposalId)!;
          if (planForR.linkedFlag) {
            await txAuditLogRepo.addAuditLog({
              organizationId: authContext.organizationId,
              organizationSlug: authContext.organizationSlug,
              auditAction: 'feature_flag.updated',
              action: 'updated',
              actorId: authContext.userId,
              auditableType: 'feature_flag',
              auditableDisplayName: r.featureFlagName,
              apiKeyName: authContext.apiKeyName,
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
              targetNamespaceId: federatedGraph.namespaceId,
              targetNamespaceDisplayName: federatedGraph.namespace,
            });
          }
        }

        // Single composeAndDeployGraphs call → single CDN push → single router
        // config reload. This is the whole point of the bulk endpoint. Running
        // inside the transaction means a CDN/composition failure rolls the DB
        // back so the router's stale config and the DB stay in sync.
        const { compositionErrors } = await txFedGraphRepo.composeAndDeployGraphs({
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
        for (const e of compositionErrors) {
          if (ffNamesInBatch.has(e.featureFlag)) {
            compositionFailures.push({ featureFlag: e.featureFlag, message: e.message });
          }
        }
        if (compositionFailures.length > 0) {
          throw new BulkRolloutError(
            EnumStatusCode.ERR,
            `One or more rollout feature flags failed to compose at the new percentages. ` +
              `The router will keep falling back to base for those flags until fixed.\n` +
              compositionFailures.map((e) => `${e.featureFlag}: ${e.message}`).join('\n'),
          );
        }
      });
    } catch (e) {
      if (e instanceof BulkRolloutError) {
        return {
          response: { code: e.code, details: e.message },
          items: [],
        };
      }
      throw e;
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

// Internal sentinel: thrown to abort the transaction with a structured response.
// `handleError` doesn't recognize it, but the catch block at the boundary of
// `db.transaction` rolls back and we re-classify into a typed Connect response.
class BulkRolloutError extends Error {
  constructor(
    public code: EnumStatusCode,
    message: string,
  ) {
    super(message);
    this.name = 'BulkRolloutError';
  }
}
