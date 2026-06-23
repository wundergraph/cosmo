import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import AuthUtils from '../auth-utils.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { OidcRepository } from '../repositories/OidcRepository.js';
import { NamespaceLoginMethodRepository } from '../repositories/NamespaceLoginMethodRepository.js';
import { OrganizationLoginMethodRepository } from '../repositories/OrganizationLoginMethodRepository.js';
import { traced } from '../tracing.js';
import type { LoginMethod } from '../../types/index.js';
import { buildAuthState } from '../util.js';
import type { RBACEvaluator } from './RBACEvaluator.js';

export type AccessTokenAuthContext = {
  auth: 'access_token';
  userId: string;
  userDisplayName: string;
  organizationId: string;
  organizationSlug: string;
  organizationDeactivated: boolean;
  rbac: RBACEvaluator;
  loginMethod: LoginMethod;
};

@traced
export default class AccessTokenAuthenticator {
  constructor(
    private orgRepo: OrganizationRepository,
    private authUtils: AuthUtils,
    private oidcRepo: OidcRepository,
    private namespaceLoginMethodRepo: NamespaceLoginMethodRepository,
    private orgLoginMethodRepo: OrganizationLoginMethodRepository,
  ) {}

  /**
   * Authenticates the user with the given access token. Returns the user's organization ID and user's ID.
   */
  public async authenticate(accessToken: string, organizationSlug: string | null): Promise<AccessTokenAuthContext> {
    const userInfoData = await this.authUtils.getUserInfo(accessToken);

    const orgSlug = organizationSlug || userInfoData.groups?.[0]?.split('/')?.[1];
    if (!orgSlug) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Cannot determine organization slug');
    }

    const organization = await this.orgRepo.bySlug(orgSlug);

    if (!organization || !organization?.id) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Organization does not exist');
    }

    const isMember = await this.orgRepo.isMemberOf({
      userId: userInfoData.sub,
      organizationId: organization.id,
    });

    if (!isMember) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'User is not a member of the organization');
    }

    const organizationDeactivated = !!organization.deactivation;

    // The access token is minted from the user's interactive login, so it
    // carries the same login method (and therefore the same IdP gate) as a web
    // session, derived from the `identity_provider` claim on the userinfo
    // response (absent → password login).
    const { loginMethod, rbac } = await buildAuthState(
      {
        oidcRepo: this.oidcRepo,
        orgRepo: this.orgRepo,
        namespaceLoginMethodRepo: this.namespaceLoginMethodRepo,
        orgLoginMethodRepo: this.orgLoginMethodRepo,
      },
      { organizationId: organization.id, userId: userInfoData.sub, idpAlias: userInfoData.identity_provider },
    );

    return {
      auth: 'access_token',
      organizationId: organization.id,
      organizationSlug: organization.slug,
      userId: userInfoData.sub,
      userDisplayName: userInfoData.email,
      organizationDeactivated,
      rbac,
      loginMethod,
    };
  }

  public getUserInfo(accessToken: string) {
    return this.authUtils.getUserInfo(accessToken);
  }
}
