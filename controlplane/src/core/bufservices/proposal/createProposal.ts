import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateProposalRequest,
  CreateProposalResponse,
  Label,
  ProposalNamingConvention,
  ProposalSubgraph,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Composer } from '../../composition/composer.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { SchemaUsageTrafficInspector } from '../../services/SchemaUsageTrafficInspector.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createProposal(
  opts: RouterOptions,
  req: CreateProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);
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
        proposalUrl: '',
        proposalName: '',
      };
    }

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
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
        proposalUrl: '',
        proposalName: '',
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    if (!namespace.enableProposals) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Proposals are not enabled for namespace ${req.namespace}`,
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
        proposalUrl: '',
        proposalName: '',
      };
    }

    let proposalName = req.name;

    if (req.namingConvention === ProposalNamingConvention.NORMAL) {
      // checking if the name starts with p- and followed by any integer
      const proposalNameRegex = /^p-\d+$/;
      if (proposalNameRegex.test(req.name)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Proposal name cannot start with p-`,
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
          proposalUrl: '',
          proposalName: '',
        };
      }
    } else {
      const count = await proposalRepo.countByFederatedGraphId({
        federatedGraphId: federatedGraph.id,
      });
      proposalName = `p-${count + 1}/${req.name}`;
    }

    const existingProposal = await proposalRepo.ByName({
      name: proposalName,
      federatedGraphId: federatedGraph.id,
    });
    if (existingProposal) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Proposal ${proposalName} already exists.`,
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
        proposalUrl: '',
        proposalName: '',
      };
    }

    if (req.subgraphs.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `No subgraphs provided. At least one subgraph is required to create a proposal.`,
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
        proposalUrl: '',
        proposalName: '',
      };
    }

    const subgraphNames = req.subgraphs.map((subgraph) => subgraph.name);
    const uniqueSubgraphNames = new Set(subgraphNames);
    if (uniqueSubgraphNames.size !== subgraphNames.length) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The subgraphs provided in the proposal have to be unique. Please check the names of the subgraphs and try again.`,
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
        proposalUrl: '',
        proposalName: '',
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

    for (const proposalSubgraph of req.subgraphs) {
      const subgraph = await subgraphRepo.byName(proposalSubgraph.name, req.namespace);
      if (subgraph) {
        const isSubgraphPartOfFedGraph = subgraphsOfFedGraph.some((s) => s.name === proposalSubgraph.name);
        if (!isSubgraphPartOfFedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Subgraph ${proposalSubgraph.name} is not part of the federated graph ${federatedGraph.name}`,
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
            proposalUrl: '',
            proposalName: '',
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
            proposalUrl: '',
            proposalName: '',
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
            proposalUrl: '',
            proposalName: '',
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

    const proposal = await proposalRepo.createProposal({
      federatedGraphId: federatedGraph.id,
      name: proposalName,
      userId: authContext.userId,
      proposalSubgraphs,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'proposal.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'proposal',
      auditableDisplayName: proposal.name,
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
        proposalID: proposal.id,
      });
    }

    return {
      response,
      proposalId: proposal.id,
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
      proposalUrl: `${process.env.WEB_BASE_URL}/${authContext.organizationSlug}/${namespace.name}/graph/${federatedGraph.name}/proposals/${proposal.id}`,
      proposalName: proposal.name,
      isLinkedTrafficCheckFailed,
      isLinkedPruningCheckFailed,
    };
  });
}
