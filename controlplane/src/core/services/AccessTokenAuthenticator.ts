import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import AuthUtils from '../auth-utils.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { RBACEvaluator } from './RBACEvaluator.js';

export type AccessTokenAuthContext = {
  auth: 'access_token';
  userId: string;
  userDisplayName: string;
  organizationId: string;
  organizationSlug: string;
  organizationDeactivated: boolean;
  rbac: RBACEvaluator;
};

export default class AccessTokenAuthenticator {
  constructor(
    private orgRepo: OrganizationRepository,
    private authUtils: AuthUtils,
  ) {}

  /**
   * Authenticates the user with the given access token. Returns the user's organization ID and user's ID.
   */
  public async authenticate(accessToken: string, organizationSlug: string | null): Promise<AccessTokenAuthContext> {
    const userInfoData = await this.authUtils.getUserInfo(accessToken);

    const orgSlug = organizationSlug || userInfoData.groups[0].split('/')[1];

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
    const rbac = new RBACEvaluator(
      await this.orgRepo.getOrganizationMemberGroups({
        userID: userInfoData.sub,
        organizationID: organization.id,
      }),
      userInfoData.sub,
    );

    return {
      auth: 'access_token',
      organizationId: organization.id,
      organizationSlug: organization.slug,
      userId: userInfoData.sub,
      userDisplayName: userInfoData.email,
      organizationDeactivated,
      rbac,
    };
  }
}
