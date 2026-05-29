import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrganizationLoginMethodsRequest,
  UpdateOrganizationLoginMethodsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { NamespaceLoginMethodRepository } from '../../repositories/NamespaceLoginMethodRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationLoginMethodRepository } from '../../repositories/OrganizationLoginMethodRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  enrichLogger,
  getLogger,
  handleError,
  isLoginMethodAllowedToUpdate,
  doesNamespaceMappingExceedsOrgAllowList,
} from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateOrganizationLoginMethods(
  opts: RouterOptions,
  req: UpdateOrganizationLoginMethodsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrganizationLoginMethodsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrganizationLoginMethodsResponse>>(ctx, logger, async () => {
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
        requiresConfirmation: false,
        affectedNamespaces: [],
      };
    }

    // Only interactive sessions may change this, so the self-lockout guard
    // always has a login method to validate.
    const actorMethod = authContext.loginMethod;
    if (!actorMethod || actorMethod.type === 'api-key') {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Login methods can only be changed from an interactive session, not an API key.',
        },
        requiresConfirmation: false,
        affectedNamespaces: [],
      };
    }

    const allow = {
      allowPasswordLogin: req.allowPasswordLogin,
      allowGoogleLogin: req.allowGoogleLogin,
      allowGithubLogin: req.allowGithubLogin,
      allowedSsoProviderIds: req.allowedSsoProviderIds,
    };

    // An empty allow-list means "no restriction": every login method is allowed
    // (default-open). It is the safe state, so the floor, the self-lockout block,
    // and namespace reconciliation are all skipped — nothing is disallowed.
    const isUnrestricted =
      !allow.allowPasswordLogin &&
      !allow.allowGoogleLogin &&
      !allow.allowGithubLogin &&
      allow.allowedSsoProviderIds.length === 0;

    const affected: { id: string; name: string }[] = [];

    if (!isUnrestricted) {
      // Validate provider ids belong to the org.
      const oidcRepo = new OidcRepository(opts.db);
      const orgProviderIds = new Set(
        (await oidcRepo.listOidcProvidersByOrganizationId({ organizationId: authContext.organizationId })).map(
          (p) => p.id,
        ),
      );
      for (const id of allow.allowedSsoProviderIds) {
        if (!orgProviderIds.has(id)) {
          return {
            response: { code: EnumStatusCode.ERR_BAD_REQUEST, details: `Unknown SSO provider id: ${id}` },
            requiresConfirmation: false,
            affectedNamespaces: [],
          };
        }
      }

      // Self-lockout block: the actor's current method must stay allowed.
      if (!isLoginMethodAllowedToUpdate(allow, actorMethod)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details:
              'This change would lock you out: your current login method would no longer be allowed. Sign in with an allowed method first, then apply the change.',
          },
          requiresConfirmation: false,
          affectedNamespaces: [],
        };
      }

      // Namespace reconciliation: find namespace mappings referencing a method the
      // new org allow-list disallows.
      const mappingRepo = new NamespaceLoginMethodRepository(opts.db);
      const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
      const mappings = await mappingRepo.listMappings({ organizationId: authContext.organizationId });
      for (const m of mappings) {
        if (doesNamespaceMappingExceedsOrgAllowList(m, allow)) {
          const ns = await namespaceRepo.byId(m.namespaceId);
          if (ns) {
            affected.push({ id: ns.id, name: ns.name });
          }
        }
      }
    }

    if (affected.length > 0 && !req.confirmNamespaceChanges) {
      return {
        response: { code: EnumStatusCode.OK },
        requiresConfirmation: true,
        affectedNamespaces: affected.map((a) => ({ id: a.id, name: a.name })),
      };
    }

    const repo = new OrganizationLoginMethodRepository(opts.db);
    await repo.setAllowedLoginMethods({ organizationId: authContext.organizationId, ...allow });

    const auditRepo = new AuditLogRepository(opts.db);
    await auditRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization_login_methods.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'organization_login_methods',
      auditableDisplayName: authContext.organizationSlug,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      apiKeyName: authContext.apiKeyName,
    });

    return { response: { code: EnumStatusCode.OK }, requiresConfirmation: false, affectedNamespaces: [] };
  });
}
