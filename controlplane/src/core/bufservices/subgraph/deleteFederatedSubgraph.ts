import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  DeleteFederatedSubgraphRequest,
  DeleteFederatedSubgraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getFederatedGraphRouterCompatibilityVersion, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteFederatedSubgraph(
  opts: RouterOptions,
  req: DeleteFederatedSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteFederatedSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteFederatedSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

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
      };
    }

    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.subgraphName}" was not found.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check if the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraph.targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
      isDeleteOperation: true,
    });

    let proposalMatchMessage: string | undefined;
    let matchedEntity:
      | {
          proposalId: string;
          proposalSubgraphId: string;
        }
      | undefined;
    if (namespace.enableProposals) {
      const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: subgraph.labels,
        namespaceId: namespace.id,
      });
      const proposalConfig = await proposalRepo.getProposalConfig({ namespaceId: namespace.id });
      if (proposalConfig) {
        const match = await proposalRepo.matchSchemaWithProposal({
          subgraphName: subgraph.name,
          namespaceId: namespace.id,
          schemaSDL: '',
          routerCompatibilityVersion: getFederatedGraphRouterCompatibilityVersion(federatedGraphs),
          isDeleted: true,
        });
        if (!match) {
          if (proposalConfig.publishSeverityLevel === 'warn') {
            proposalMatchMessage = `The subgraph ${subgraph.name} is not proposed to be deleted in any of the approved proposals.`;
          } else {
            return {
              response: {
                code: EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL,
                details: `The subgraph ${subgraph.name} is not proposed to be deleted in any of the approved proposals.`,
              },
              compositionErrors: [],
              deploymentErrors: [],
              compositionWarnings: [],
              proposalMatchMessage: `The subgraph ${subgraph.name} is not proposed to be deleted in any of the approved proposals.`,
            };
          }
        }
        matchedEntity = match;
      }
    }

    const { affectedFederatedGraphs, compositionErrors, deploymentErrors, compositionWarnings } =
      await opts.db.transaction(async (tx) => {
        const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
        const featureFlagRepo = new FeatureFlagRepository(logger, tx, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(tx);

        let labels = subgraph.labels;
        if (subgraph.isFeatureSubgraph) {
          const baseSubgraph = await featureFlagRepo.getBaseSubgraphByFeatureSubgraphId({ id: subgraph.id });
          if (baseSubgraph) {
            labels = baseSubgraph.labels;
          }
        } else {
          await featureFlagRepo.deleteFeatureSubgraphsByBaseSubgraphId({
            subgraphId: subgraph.id,
            namespaceId: subgraph.namespaceId,
          });
        }

        // Collect all federated graphs that used this subgraph before deleting subgraph to include them in the composition
        const affectedFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
          labels,
          namespaceId: subgraph.namespaceId,
          excludeContracts: true,
        });

        // Delete the subgraph
        await subgraphRepo.delete(subgraph.targetId);

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: subgraph.isFeatureSubgraph ? 'feature_subgraph.deleted' : 'subgraph.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: subgraph.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
          auditableDisplayName: subgraph.name,
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });

        // Recompose and deploy all affected federated graphs and their respective contracts.
        // Collects all composition and deployment errors if any.
        const { compositionErrors, deploymentErrors, compositionWarnings } = await fedGraphRepo.composeAndDeployGraphs({
          federatedGraphs: affectedFederatedGraphs,
          blobStorage: opts.blobStorage,
          admissionConfig: {
            webhookJWTSecret: opts.admissionWebhookJWTSecret,
            cdnBaseUrl: opts.cdnBaseUrl,
          },
          actorId: authContext.userId,
          chClient: opts.chClient!,
        });

        return { affectedFederatedGraphs, compositionErrors, deploymentErrors, compositionWarnings };
      });

    for (const affectedFederatedGraph of affectedFederatedGraphs) {
      const hasErrors =
        compositionErrors.some((error) => error.federatedGraphName === affectedFederatedGraph.name) ||
        deploymentErrors.some((error) => error.federatedGraphName === affectedFederatedGraph.name);
      orgWebhooks.send(
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: affectedFederatedGraph.id,
              name: affectedFederatedGraph.name,
              namespace: affectedFederatedGraph.namespace,
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

    // if this subgraph is part of a proposal, mark the proposal subgraph as published
    // and if all proposal subgraphs are published, update the proposal state to PUBLISHED
    if (matchedEntity) {
      const { allSubgraphsPublished } = await proposalRepo.markProposalSubgraphAsPublished({
        proposalSubgraphId: matchedEntity.proposalSubgraphId,
        proposalId: matchedEntity.proposalId,
      });
      if (allSubgraphsPublished) {
        const proposal = await proposalRepo.ById(matchedEntity.proposalId);
        if (proposal) {
          const federatedGraph = await fedGraphRepo.byId(proposal.proposal.federatedGraphId);
          if (federatedGraph) {
            orgWebhooks.send(
              {
                eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
                payload: {
                  federated_graph: {
                    id: federatedGraph.id,
                    name: federatedGraph.name,
                    namespace: federatedGraph.namespace,
                  },
                  organization: {
                    id: authContext.organizationId,
                    slug: authContext.organizationSlug,
                  },
                  proposal: {
                    id: proposal.proposal.id,
                    name: proposal.proposal.name,
                    namespace: req.namespace,
                    state: 'PUBLISHED',
                  },
                  actor_id: authContext.userId,
                },
              },
              authContext.userId,
            );
          }
        }
      }
    }

    if (compositionErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
        },
        deploymentErrors: [],
        compositionErrors,
        compositionWarnings,
        proposalMatchMessage,
      };
    }

    if (deploymentErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
        deploymentErrors,
        compositionErrors: [],
        compositionWarnings,
        proposalMatchMessage,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      deploymentErrors: [],
      compositionErrors: [],
      compositionWarnings,
      proposalMatchMessage,
    };
  });
}
