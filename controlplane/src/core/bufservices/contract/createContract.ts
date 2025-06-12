import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CompositionError,
  CompositionWarning,
  CreateContractRequest,
  CreateContractResponse,
  DeploymentError,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { UnauthorizedError, PublicError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidGraphName, isValidSchemaTags } from '../../util.js';

export function createContract(
  opts: RouterOptions,
  req: CreateContractRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateContractResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateContractResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return opts.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(logger, tx, opts.billingDefaultPlanId);
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const auditLogRepo = new AuditLogRepository(tx);
      const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);
      const contractRepo = new ContractRepository(logger, tx, authContext.organizationId);

      if (authContext.organizationDeactivated) {
        throw new UnauthorizedError();
      }

      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Could not find namespace ${req.namespace}`);
      }

      // check whether the user is authorized to perform the action
      if (!authContext.rbac.canCreateContract(namespace)) {
        throw new UnauthorizedError();
      }

      if (await fedGraphRepo.exists(req.name, req.namespace)) {
        throw new PublicError(
          EnumStatusCode.ERR_ALREADY_EXISTS,
          `A graph '${req.name}' already exists in the namespace`,
        );
      }

      if (!isValidUrl(req.routingUrl)) {
        throw new PublicError(EnumStatusCode.ERR, `Routing URL is not a valid URL`);
      }

      if (req.admissionWebhookUrl && !isValidUrl(req.admissionWebhookUrl)) {
        throw new PublicError(EnumStatusCode.ERR, `Admission Webhook URL is not a valid URL`);
      }

      if (req.includeTags.length > 0 && req.excludeTags.length > 0) {
        throw new PublicError(
          EnumStatusCode.ERR,
          `The "exclude" and "include" options for tags are currently mutually exclusive.` +
            ` Both options have been provided, but one of the options must be empty or unset.`,
        );
      }

      req.excludeTags = [...new Set(req.excludeTags)];

      if (!isValidSchemaTags(req.excludeTags)) {
        throw new PublicError(EnumStatusCode.ERR, `Provided exclude tags are invalid`);
      }

      req.includeTags = [...new Set(req.includeTags)];
      if (!isValidSchemaTags(req.includeTags)) {
        throw new PublicError(EnumStatusCode.ERR, `Provided include tags are invalid`);
      }

      if (!isValidGraphName(req.name)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_NAME,
            details: `The name of the contract is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      const count = await fedGraphRepo.count();

      const feature = await orgRepo.getFeature({
        organizationId: authContext.organizationId,
        featureId: 'federated-graphs',
      });

      const limit = feature?.limit === -1 ? undefined : feature?.limit;

      if (limit && count >= limit) {
        throw new PublicError(
          EnumStatusCode.ERR_LIMIT_REACHED,
          `The organization reached the limit of federated graphs and monographs`,
        );
      }

      const sourceGraph = await fedGraphRepo.byName(req.sourceGraphName, req.namespace);
      if (!sourceGraph) {
        throw new PublicError(
          EnumStatusCode.ERR_NOT_FOUND,
          `Could not find source graph ${req.sourceGraphName} in namespace ${req.namespace}`,
        );
      }

      // Ignore composability for monographs
      if (sourceGraph.supportsFederation && !sourceGraph.isComposable) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details:
              `The source graph "${req.sourceGraphName}" is not currently composable.` +
              ` A contract can only be created if its respective source graph has composed successfully.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      if (sourceGraph.contract) {
        throw new PublicError(
          EnumStatusCode.ERR,
          `The source graph ${sourceGraph.name} is already a contract. You cannot create a contract from another contract.`,
        );
      }

      const contractGraph = await fedGraphRepo.create({
        name: req.name,
        createdBy: authContext.userId,
        labelMatchers: sourceGraph.labelMatchers,
        routingUrl: req.routingUrl,
        readme: req.readme,
        namespace: req.namespace,
        namespaceId: namespace.id,
        admissionWebhookURL: req.admissionWebhookUrl,
        admissionWebhookSecret: req.admissionWebhookSecret,
        supportsFederation: sourceGraph.supportsFederation,
      });

      const contract = await contractRepo.create({
        sourceFederatedGraphId: sourceGraph.id,
        downstreamFederatedGraphId: contractGraph.id,
        excludeTags: req.excludeTags,
        includeTags: req.includeTags,
        actorId: authContext.userId,
      });

      await fedGraphRepo.createGraphCryptoKeyPairs({
        federatedGraphId: contractGraph.id,
        organizationId: authContext.organizationId,
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'federated_graph.created',
        action: 'created',
        actorId: authContext.userId,
        auditableType: 'federated_graph',
        auditableDisplayName: contractGraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: contractGraph.namespaceId,
        targetNamespaceDisplayName: contractGraph.namespace,
      });

      const compositionErrors: PlainMessage<CompositionError>[] = [];
      const deploymentErrors: PlainMessage<DeploymentError>[] = [];
      const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

      const composition = await fedGraphRepo.composeAndDeployGraphs({
        federatedGraphs: [{ ...contractGraph, contract }],
        actorId: authContext.userId,
        blobStorage: opts.blobStorage,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        chClient: opts.chClient!,
      });

      compositionErrors.push(...composition.compositionErrors);
      deploymentErrors.push(...composition.deploymentErrors);
      compositionWarnings.push(...composition.compositionWarnings);

      if (compositionErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
          },
          compositionErrors,
          compositionWarnings,
          deploymentErrors: [],
        };
      }

      if (deploymentErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
          },
          compositionErrors: [],
          compositionWarnings,
          deploymentErrors,
        };
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        compositionErrors,
        compositionWarnings,
        deploymentErrors,
      };
    });
  });
}
