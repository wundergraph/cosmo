import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { UpdateContractRequest, UpdateContractResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidSchemaTags } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';

export function updateContract(
  opts: RouterOptions,
  req: UpdateContractRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateContractResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateContractResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
      opts.webhookProxyUrl,
    );

    req.excludeTags = [...new Set(req.excludeTags)];
    req.includeTags = [...new Set(req.includeTags)];

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (req.includeTags.length > 0 && req.excludeTags.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            `The "exclude" and "include" options for tags are currently mutually exclusive.` +
            ` Both options have been provided, but one of the options must be empty or unset.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!isValidSchemaTags(req.excludeTags)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Provided exclude tags are invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!isValidSchemaTags(req.includeTags)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Provided include tags are invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const graph = await fedGraphRepo.byName(req.name, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find contract graph ${req.name} in namespace ${req.namespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
      throw new UnauthorizedError();
    }

    if (!graph.contract?.id) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The graph is not a contract`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const { deploymentErrors, compositionErrors, compositionWarnings } = await opts.db.transaction(async (tx) => {
      const contractRepo = new ContractRepository(logger, tx, authContext.organizationId);
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const compositionService = new CompositionService(
        tx,
        authContext.organizationId,
        logger,
        { cdnBaseUrl: opts.cdnBaseUrl, webhookJWTSecret: opts.admissionWebhookJWTSecret },
        opts.blobStorage,
        opts.chClient,
        opts.webhookProxyUrl,
        req.disableResolvabilityValidation,
      );

      // Update the contract details
      const updatedContractDetails = await contractRepo.update({
        id: graph.contract!.id,
        excludeTags: req.excludeTags,
        includeTags: req.includeTags,
        actorId: authContext.userId,
      });

      // Update the federated graph details
      await fedGraphRepo.update({
        compositionService,
        targetId: graph.targetId,
        // if the routingUrl is not provided, it will be set to an empty string.
        // As the routing url wont be updated in this case.
        routingUrl: req.routingUrl || '',
        updatedBy: authContext.userId,
        readme: req.readme,
        namespaceId: graph.namespaceId,
        admissionWebhookURL: req.admissionWebhookUrl,
        admissionWebhookSecret: req.admissionWebhookSecret,
        labelMatchers: [],
      });

      // Compose the contract
      return await compositionService.composeAndDeployFederatedGraph({
        actorId: authContext.userId,
        federatedGraph: {
          ...graph!,
          routingUrl: req.routingUrl || graph.routingUrl,
          admissionWebhookURL: req.admissionWebhookUrl || graph.admissionWebhookURL,
          admissionWebhookSecret: req.admissionWebhookSecret || graph.admissionWebhookSecret,
          readme: req.readme || graph.readme,
          contract: { ...graph.contract!, ...updatedContractDetails },
        },
      });
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'federated_graph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: graph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: graph.namespaceId,
      targetNamespaceDisplayName: graph.namespace,
    });

    orgWebhooks.send(
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        payload: {
          federated_graph: {
            id: graph.id,
            name: graph.name,
            namespace: graph.namespace,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
          actor_id: authContext.userId,
        },
      },
      authContext.userId,
    );

    return {
      response: {
        code:
          compositionErrors.length > 0
            ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
            : deploymentErrors.length > 0
              ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
              : EnumStatusCode.OK,
      },
      deploymentErrors,
      compositionErrors,
      compositionWarnings,
    };
  });
}
