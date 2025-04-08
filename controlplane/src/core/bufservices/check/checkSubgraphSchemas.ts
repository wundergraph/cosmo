import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CheckSubgraphSchemasRequest,
  CheckSubgraphSchemasResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Composer } from '../../composition/composer.js';
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

export function checkSubgraphSchemas(
  opts: RouterOptions,
  req: CheckSubgraphSchemasRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CheckSubgraphSchemasResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CheckSubgraphSchemasResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const schemaLintRepo = new SchemaLintRepository(opts.db);
    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
    const schemaCheckRepo = new SchemaCheckRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);
    const graphCompostionRepo = new GraphCompositionRepository(logger, opts.db);
    const proposalRepo = new ProposalRepository(opts.db);
    const trafficInspector = new SchemaUsageTrafficInspector(opts.chClient!);

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user does not have the permissions to perform this operation`,
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

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
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

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
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
      proposalMatchMessage,
    } = await schemaCheckRepo.checkMultipleSchemas({
      organizationId: authContext.organizationId,
      orgRepo,
      subgraphRepo,
      fedGraphRepo,
      schemaLintRepo,
      schemaGraphPruningRepo,
      proposalRepo,
      trafficInspector,
      composer,
      subgraphs: req.subgraphs,
      namespace,
      logger,
      vcsContext: req.vcsContext,
      chClient: opts.chClient,
      skipProposalMatchCheck: false,
    });

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
      checkUrl: `${process.env.WEB_BASE_URL}/${authContext.organizationSlug}/${namespace.name}/graph/$federatedGraphName/checks/${checkId}`,
      proposalMatchMessage,
    };
  });
}
