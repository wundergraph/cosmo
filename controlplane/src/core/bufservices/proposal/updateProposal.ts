import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  Label,
  ProposalSubgraph,
  UpdateProposalRequest,
  UpdateProposalResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { ProposalState } from '../../../db/models.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { SchemaUsageTrafficInspector } from '../../services/SchemaUsageTrafficInspector.js';
import { Composer } from '../../composition/composer.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateProposal(
  opts: RouterOptions,
  req: UpdateProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const proposalRepo = new ProposalRepository(opts.db);
    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace ${req.namespace} not found`,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    if (!namespace.enableProposals) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Proposals are not enabled for namespace ${req.namespace}`,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const proposal = await proposalRepo.ByName({
      name: req.proposalName,
      federatedGraphId: federatedGraph.id,
    });
    if (!proposal) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Proposal ${req.proposalName} not found`,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    if (req.updateAction.case === 'state') {
      const stateValue = req.updateAction.value as ProposalState;
      await proposalRepo.updateProposal({
        id: proposal.proposal.id,
        state: stateValue,
        proposalSubgraphs: [],
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction:
          stateValue === 'APPROVED'
            ? 'proposal.approved'
            : stateValue === 'PUBLISHED'
              ? 'proposal.published'
              : stateValue === 'CLOSED'
                ? 'proposal.closed'
                : 'proposal.updated',
        action: 'updated',
        actorId: authContext.userId,
        auditableType: 'proposal',
        auditableDisplayName: proposal.proposal.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: federatedGraph.namespaceId,
        targetNamespaceDisplayName: federatedGraph.namespace,
      });

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
              state: stateValue,
            },
            actor_id: authContext.userId,
          },
        },
        authContext.userId,
      );

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    } else if (req.updateAction.case === 'updatedSubgraphs') {
      if (proposal.proposal.state !== 'DRAFT') {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Proposal is in ${proposal.proposal.state} state, cannot update subgraphs`,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: '',
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
          lintingSkipped: false,
          graphPruningSkipped: false,
          checkUrl: '',
        };
      }

      if (req.updateAction.value.subgraphs.length === 0) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `No subgraphs provided. At least one subgraph is required to update a proposal.`,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: '',
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
          lintingSkipped: false,
          graphPruningSkipped: false,
          checkUrl: '',
        };
      }

      const subgraphNames = req.updateAction.value.subgraphs.map((subgraph) => subgraph.name);
      const uniqueSubgraphNames = new Set(subgraphNames);
      if (uniqueSubgraphNames.size !== subgraphNames.length) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `The subgraphs provided in the proposal have to be unique. Please check the names of the subgraphs and try again.`,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: '',
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
          lintingSkipped: false,
          graphPruningSkipped: false,
          checkUrl: '',
        };
      }

      const subgraphsOfFedGraph = await subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: federatedGraph.targetId,
      });

      const proposalSubgraphs: {
        subgraphId?: string;
        subgraphName: string;
        schemaSDL: string;
        isDeleted: boolean;
        isNew: boolean;
        currentSchemaVersionId?: string;
        labels: Label[];
      }[] = [];

      const updatedSubgraphs = req.updateAction.value.subgraphs;

      // Process subgraphs if they are provided
      for (const proposalSubgraph of updatedSubgraphs) {
        const subgraph = await subgraphRepo.byName(proposalSubgraph.name, req.namespace);

        if (subgraph) {
          // If the subgraph exists and is not part of the federated graph, return an error
          const isSubgraphPartOfFedGraph = subgraphsOfFedGraph.some((s) => s.name === proposalSubgraph.name);
          if (!isSubgraphPartOfFedGraph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Subgraph ${proposalSubgraph.name} is not part of the federated graph ${federatedGraph.name}`,
              },
              breakingChanges: [],
              nonBreakingChanges: [],
              compositionErrors: [],
              checkId: '',
              lintWarnings: [],
              lintErrors: [],
              graphPruneWarnings: [],
              graphPruneErrors: [],
              compositionWarnings: [],
              lintingSkipped: false,
              graphPruningSkipped: false,
              checkUrl: '',
            };
          }

          if (subgraph.isFeatureSubgraph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details:
                  `The subgraph "${subgraph.name}" is a feature subgraph.` +
                  ` Feature subgraphs are not currently supported for proposals.`,
              },
              breakingChanges: [],
              nonBreakingChanges: [],
              compositionErrors: [],
              checkId: '',
              lintWarnings: [],
              lintErrors: [],
              graphPruneWarnings: [],
              graphPruneErrors: [],
              compositionWarnings: [],
              lintingSkipped: false,
              graphPruningSkipped: false,
              checkUrl: '',
            };
          }

          if (proposalSubgraph.isNew) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Subgraph ${proposalSubgraph.name} is marked as new, but a subgraph with the same name already exists.`,
              },
              proposalId: '',
              breakingChanges: [],
              nonBreakingChanges: [],
              compositionErrors: [],
              checkId: '',
              lintWarnings: [],
              lintErrors: [],
              graphPruneWarnings: [],
              graphPruneErrors: [],
              compositionWarnings: [],
              lintingSkipped: false,
              graphPruningSkipped: false,
              checkUrl: '',
            };
          }
        }

        proposalSubgraphs.push({
          subgraphId: subgraph?.id,
          subgraphName: proposalSubgraph.name,
          schemaSDL: proposalSubgraph.schemaSDL,
          isDeleted: proposalSubgraph.isDeleted,
          isNew: !subgraph,
          currentSchemaVersionId: subgraph?.schemaVersionId,
          labels: proposalSubgraph.labels,
        });
      }

      await proposalRepo.updateProposal({
        id: proposal.proposal.id,
        proposalSubgraphs,
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'proposal.updated',
        action: 'updated',
        actorId: authContext.userId,
        auditableType: 'proposal',
        auditableDisplayName: proposal.proposal.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: federatedGraph.namespaceId,
        targetNamespaceDisplayName: federatedGraph.namespace,
      });

      const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
      const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
      const schemaLintRepo = new SchemaLintRepository(opts.db);
      const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
      const schemaCheckRepo = new SchemaCheckRepository(opts.db);
      const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);
      const graphCompostionRepo = new GraphCompositionRepository(logger, opts.db);
      const trafficInspector = new SchemaUsageTrafficInspector(opts.chClient!);
      const composer = new Composer(
        logger,
        opts.db,
        fedGraphRepo,
        subgraphRepo,
        contractRepo,
        graphCompostionRepo,
        opts.chClient,
      );

      const {
        response,
        breakingChanges,
        nonBreakingChanges,
        compositionErrors,
        checkId,
        lintWarnings,
        lintErrors,
        graphPruneWarnings,
        graphPruneErrors,
        compositionWarnings,
        operationUsageStats,
        isLinkedTrafficCheckFailed,
        isLinkedPruningCheckFailed,
      } = await schemaCheckRepo.checkMultipleSchemas({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        orgRepo,
        subgraphRepo,
        fedGraphRepo,
        schemaLintRepo,
        schemaGraphPruningRepo,
        proposalRepo,
        trafficInspector,
        composer,
        subgraphs: proposalSubgraphs.map(
          (subgraph) =>
            new ProposalSubgraph({
              name: subgraph.subgraphName,
              schemaSDL: subgraph.schemaSDL,
              labels: subgraph.labels,
              isDeleted: subgraph.isDeleted,
              isNew: subgraph.isNew,
            }),
        ),
        namespace,
        logger,
        chClient: opts.chClient,
        skipProposalMatchCheck: true,
      });

      if (checkId) {
        await schemaCheckRepo.createSchemaCheckProposal({
          schemaCheckID: checkId,
          proposalID: proposal.proposal.id,
        });
      }

      return {
        response,
        breakingChanges,
        nonBreakingChanges,
        compositionErrors,
        checkId,
        lintWarnings,
        lintErrors,
        graphPruneWarnings,
        graphPruneErrors,
        compositionWarnings,
        operationUsageStats,
        lintingSkipped: !namespace.enableLinting,
        graphPruningSkipped: !namespace.enableGraphPruning,
        checkUrl: `${process.env.WEB_BASE_URL}/${authContext.organizationSlug}/${namespace.name}/graph/${federatedGraph.name}/checks/${checkId}`,
        isLinkedPruningCheckFailed,
        isLinkedTrafficCheckFailed,
      };
    } else {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid update action, only state and updatedSubgraphs are supported',
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }
  });
}
