import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ValidateAndFetchPluginDataRequest,
  ValidateAndFetchPluginDataResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PluginApiKeyJwtPayload } from '../../../types/index.js';
import { audiences, nowInSeconds, signJwtHS256 } from '../../crypto/jwt.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { PluginRepository } from '../../repositories/PluginRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidGraphName, isValidLabels } from '../../util.js';

export function validateAndFetchPluginData(
  opts: RouterOptions,
  req: ValidateAndFetchPluginDataRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ValidateAndFetchPluginDataResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ValidateAndFetchPluginDataResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const pluginRepo = new PluginRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    req.namespace = req.namespace || DefaultNamespace;

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        newVersion: '',
        pushToken: '',
        reference: '',
      };
    }

    let subgraph = await subgraphRepo.byName(req.name, req.namespace);
    if (!subgraph) {
      if (!authContext.rbac.canCreateSubGraph(namespace)) {
        throw new UnauthorizedError();
      }

      const count = await pluginRepo.count({ namespaceId: namespace.id });
      const feature = await orgRepo.getFeature({
        organizationId: authContext.organizationId,
        featureId: 'plugins',
      });
      const limit = feature?.limit === -1 ? 0 : feature?.limit ?? 0;
      if (count >= limit) {
        return {
          response: {
            code: EnumStatusCode.ERR_LIMIT_REACHED,
            details: `The organization reached the limit of plugins`,
          },
          newVersion: '',
          pushToken: '',
          reference: '',
        };
      }

      if (!isValidGraphName(req.name)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_NAME,
            details: `The name of the subgraph is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
          },
          newVersion: '',
          pushToken: '',
          reference: '',
        };
      }

      if (!isValidLabels(req.labels)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_LABELS,
            details: `One or more labels were found to be invalid`,
          },
          newVersion: '',
          pushToken: '',
          reference: '',
        };
      }

      subgraph = await subgraphRepo.create({
        name: req.name,
        namespace: req.namespace,
        namespaceId: namespace.id,
        createdBy: authContext.userId,
        labels: req.labels,
        routingUrl: '',
        isEventDrivenGraph: false,
        type: 'grpc_plugin',
      });

      if (!subgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `The plugin "${req.name}" does not exist and could not be created.`,
          },
          newVersion: '',
          pushToken: '',
          reference: '',
        };
      }

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'subgraph.created',
        action: 'created',
        actorId: authContext.userId,
        auditableType: 'subgraph',
        auditableDisplayName: subgraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: subgraph.namespaceId,
        targetNamespaceDisplayName: subgraph.namespace,
      });
    }

    // check whether the user is authorized to perform the action
    // this authorization is to check the user has write access to the subgraph, as we are creating a token to push the plugin
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraph.targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const version = subgraph.proto?.pluginData?.version;

    let newVersion = 'v1'; // default for new plugins
    if (version) {
      const currentNumber = Number.parseInt(version.slice(1), 10);
      newVersion = `v${currentNumber + 1}`;
    }

    const reference = `${authContext.organizationId}/${subgraph.id}`;

    const pushToken = await signJwtHS256<PluginApiKeyJwtPayload>({
      secret: opts.jwtSecret,
      token: {
        iss: authContext.userId,
        aud: audiences.cosmoPluginKey, // to distinguish from other tokens
        exp: nowInSeconds() + 5 * 60, // 5 minutes
        access: [
          {
            type: 'repository',
            name: reference,
            tag: newVersion,
            actions: ['push', 'pull'],
          },
        ],
      },
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      newVersion,
      pushToken,
      reference,
    };
  });
}
