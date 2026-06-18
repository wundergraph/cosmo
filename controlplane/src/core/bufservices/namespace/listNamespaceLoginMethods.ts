import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ListNamespaceLoginMethodsRequest,
  ListNamespaceLoginMethodsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage } from '../../../types/index.js';
import { NamespaceLoginMethodRepository } from '../../repositories/NamespaceLoginMethodRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function listNamespaceLoginMethods(
  opts: RouterOptions,
  _req: ListNamespaceLoginMethodsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ListNamespaceLoginMethodsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ListNamespaceLoginMethodsResponse>>(ctx, logger, async () => {
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
        mappings: [],
      };
    }

    const mappingRepo = new NamespaceLoginMethodRepository(opts.db);
    // Pass rbac so the repo limits results to namespaces the caller's login
    // method can access (matches the namespace dropdown and the update self-check).
    const mappings = await mappingRepo.listMappings({
      organizationId: authContext.organizationId,
      rbac: authContext.rbac,
    });

    return {
      response: { code: EnumStatusCode.OK },
      mappings: mappings.map((m) => ({
        namespaceId: m.namespaceId,
        allowedSsoProviderIds: m.allowedSsoProviderIds,
        allowPasswordLogin: m.allowPasswordLogin,
        allowGoogleLogin: m.allowGoogleLogin,
        allowGithubLogin: m.allowGithubLogin,
      })),
    };
  });
}
