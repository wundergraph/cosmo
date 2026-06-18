import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateNamespaceLoginMethodsRequest,
  UpdateNamespaceLoginMethodsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage } from '../../../types/index.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { NamespaceLoginMethodRepository } from '../../repositories/NamespaceLoginMethodRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationLoginMethodRepository } from '../../repositories/OrganizationLoginMethodRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isNamespaceAllowed } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateNamespaceLoginMethods(
  opts: RouterOptions,
  req: UpdateNamespaceLoginMethodsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateNamespaceLoginMethodsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateNamespaceLoginMethodsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db);
    const feature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'login-method-restrictions',
    });
    if (!feature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: 'Login method restrictions are available on the Enterprise plan.',
        },
      };
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const oidcRepo = new OidcRepository(opts.db);
    const orgProviderIds = new Set(
      (await oidcRepo.listOidcProvidersByOrganizationId({ organizationId: authContext.organizationId })).map(
        (p) => p.id,
      ),
    );

    const orgLoginMethodRepo = new OrganizationLoginMethodRepository(opts.db);
    const orgAllowed = await orgLoginMethodRepo.getAllowedLoginMethods({ organizationId: authContext.organizationId });

    // Validate every namespace and SSO provider in the payload before writing.
    const namespacesById = new Map<string, { id: string; name: string }>();
    for (const mapping of req.mappings) {
      if (namespacesById.has(mapping.namespaceId)) {
        return {
          response: {
            code: EnumStatusCode.ERR_BAD_REQUEST,
            details: `Namespace appears more than once in the request: ${mapping.namespaceId}`,
          },
        };
      }

      const namespace = await namespaceRepo.byId(mapping.namespaceId);
      if (!namespace) {
        return {
          response: { code: EnumStatusCode.ERR_NOT_FOUND, details: `Namespace not found: ${mapping.namespaceId}` },
        };
      }

      // Gate-self check: an admin can only configure a namespace their current
      // login method can already access (prevents a compromised non-prod IdP
      // from re-mapping prod namespaces). API-key contexts are never gated, so
      // their gate is `all` and this always passes.
      if (!isNamespaceAllowed(authContext.rbac.idpNamespaceAccess, namespace.id)) {
        throw new UnauthorizedError();
      }

      for (const id of mapping.allowedSsoProviderIds) {
        if (!orgProviderIds.has(id)) {
          return { response: { code: EnumStatusCode.ERR_BAD_REQUEST, details: `Unknown SSO provider id: ${id}` } };
        }
      }

      if (orgAllowed.isRestricted) {
        if (mapping.allowPasswordLogin && !orgAllowed.allowPasswordLogin) {
          return {
            response: {
              code: EnumStatusCode.ERR_BAD_REQUEST,
              details: 'Password login is not allowed for this organization.',
            },
          };
        }
        if (mapping.allowGoogleLogin && !orgAllowed.allowGoogleLogin) {
          return {
            response: {
              code: EnumStatusCode.ERR_BAD_REQUEST,
              details: 'Google login is not allowed for this organization.',
            },
          };
        }
        if (mapping.allowGithubLogin && !orgAllowed.allowGithubLogin) {
          return {
            response: {
              code: EnumStatusCode.ERR_BAD_REQUEST,
              details: 'GitHub login is not allowed for this organization.',
            },
          };
        }
        for (const id of mapping.allowedSsoProviderIds) {
          if (!orgAllowed.allowedSsoProviderIds.includes(id)) {
            return {
              response: {
                code: EnumStatusCode.ERR_BAD_REQUEST,
                details: `SSO provider ${id} is not allowed for this organization.`,
              },
            };
          }
        }
      }

      namespacesById.set(namespace.id, namespace);
    }

    const mappingRepo = new NamespaceLoginMethodRepository(opts.db);
    await mappingRepo.setMappings({
      organizationId: authContext.organizationId,
      rbac: authContext.rbac,
      mappings: req.mappings.map((m) => ({
        namespaceId: m.namespaceId,
        ssoProviderIds: m.allowedSsoProviderIds,
        allowPasswordLogin: m.allowPasswordLogin,
        allowGoogleLogin: m.allowGoogleLogin,
        allowGithubLogin: m.allowGithubLogin,
      })),
    });

    const auditRepo = new AuditLogRepository(opts.db);
    for (const namespace of namespacesById.values()) {
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
    }

    return {
      response: { code: EnumStatusCode.OK },
    };
  });
}
