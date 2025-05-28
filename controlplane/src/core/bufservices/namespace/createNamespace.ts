import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateNamespaceRequest,
  CreateNamespaceResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidNamespaceName } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createNamespace(
  opts: RouterOptions,
  req: CreateNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.canCreateNamespace) {
      throw new UnauthorizedError();
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const isValid = isValidNamespaceName(req.name);
    if (!isValid) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            'The provided name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
        },
      };
    }

    const namespace = await namespaceRepo.byName(req.name);
    if (namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: 'The namespace already exists.',
        },
      };
    }

    const ns = await namespaceRepo.create({
      name: req.name,
      createdBy: authContext.userId,
    });

    if (!ns) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not create namespace ${req.name}`,
        },
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'namespace.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'namespace',
      auditableDisplayName: ns.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
