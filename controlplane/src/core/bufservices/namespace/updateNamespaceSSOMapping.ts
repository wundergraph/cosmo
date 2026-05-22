import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateNamespaceSSOMappingRequest,
  UpdateNamespaceSSOMappingResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { NamespaceSsoMappingRepository } from '../../repositories/NamespaceSsoMappingRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isNamespaceAllowed } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateNamespaceSSOMapping(
  opts: RouterOptions,
  req: UpdateNamespaceSSOMappingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateNamespaceSSOMappingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateNamespaceSSOMappingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const namespace = await namespaceRepo.byId(req.namespaceId);
    if (!namespace) {
      return { response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'Namespace not found' } };
    }

    // Gate-self check: an admin can only edit the mapping of a namespace their
    // current login method can already access. Prevents an attacker who has
    // compromised a non-prod IdP from re-mapping prod namespaces.
    if (authContext.idpNamespaceAccess && !isNamespaceAllowed(authContext.idpNamespaceAccess, namespace.id)) {
      throw new UnauthorizedError();
    }

    // Verify all referenced SSO providers belong to this org.
    if (req.allowedSsoProviderIds.length > 0) {
      const oidcRepo = new OidcRepository(opts.db);
      const orgOIDCProviders = await oidcRepo.listOidcProvidersByOrganizationId({
        organizationId: authContext.organizationId,
      });
      const orgProviderIds = new Set(orgOIDCProviders.map((p) => p.id));
      for (const id of req.allowedSsoProviderIds) {
        if (!orgProviderIds.has(id)) {
          return {
            response: { code: EnumStatusCode.ERR_BAD_REQUEST, details: `Unknown SSO provider id: ${id}` },
          };
        }
      }
    }

    const mappingRepo = new NamespaceSsoMappingRepository(opts.db);
    await mappingRepo.setMapping({
      namespaceId: req.namespaceId,
      ssoProviderIds: req.allowedSsoProviderIds,
      allowPasswordLogin: req.allowPasswordLogin,
    });

    const auditRepo = new AuditLogRepository(opts.db);
    await auditRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'namespace_sso_mapping.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'namespace_sso_mapping',
      auditableDisplayName: namespace.name,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      apiKeyName: authContext.apiKeyName,
      targetNamespaceId: namespace.id,
      targetNamespaceDisplayName: namespace.name,
    });

    return {
      response: { code: EnumStatusCode.OK },
    };
  });
}
