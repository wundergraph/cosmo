import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  LoginMethod,
  LoginMethodType,
  SocialLoginProvider,
  WhoAmIRequest,
  WhoAmIResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function whoAmI(
  opts: RouterOptions,
  _req: WhoAmIRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<WhoAmIResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<WhoAmIResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const organization = await orgRepo.byId(authContext.organizationId);

    if (!organization) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
        organizationName: '',
        organizationSlug: '',
        organizationId: '',
      };
    }

    const lm = authContext.loginMethod;
    const emptyLoginMethod = {
      ssoProviderId: '',
      ssoProviderName: '',
      ssoAlias: '',
      socialProvider: SocialLoginProvider.UNSPECIFIED,
    };
    let loginMethod: PlainMessage<LoginMethod>;
    switch (lm?.type) {
      case 'sso': {
        const oidcRepo = new OidcRepository(opts.db);
        const provider = await oidcRepo.getOidcProviderById({
          id: lm.ssoProviderId,
          organizationId: authContext.organizationId,
        });
        loginMethod = {
          ...emptyLoginMethod,
          type: LoginMethodType.SSO,
          ssoProviderId: lm.ssoProviderId,
          ssoProviderName: provider?.name ?? '',
          ssoAlias: lm.alias,
        };

        break;
      }
      case 'social': {
        loginMethod = {
          ...emptyLoginMethod,
          type: LoginMethodType.SOCIAL,
          socialProvider: lm.provider === 'google' ? SocialLoginProvider.GOOGLE : SocialLoginProvider.GITHUB,
        };

        break;
      }
      case 'password': {
        loginMethod = { ...emptyLoginMethod, type: LoginMethodType.PASSWORD };

        break;
      }
      case 'api-key': {
        loginMethod = { ...emptyLoginMethod, type: LoginMethodType.API_KEY };

        break;
      }
      default: {
        loginMethod = { ...emptyLoginMethod, type: LoginMethodType.UNSPECIFIED };
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      organizationId: organization.id,
      userEmail: authContext.userDisplayName,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      loginMethod,
    };
  });
}
