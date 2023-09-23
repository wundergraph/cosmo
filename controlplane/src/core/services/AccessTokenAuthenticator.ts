import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import AuthUtils from '../auth-utils.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';

export type AccessTokenAuthContext = {
  userId: string;
  organizationId: string;
};

export default class AccessTokenAuthenticator {
  constructor(private orgRepo: OrganizationRepository, private authUtils: AuthUtils) {}

  /**
   * Authenticates the user with the given access token. Returns the user's organization ID and user's ID.
   *
   * @param accessToken
   */
  public async authenticate(accessToken: string): Promise<AccessTokenAuthContext> {
    const userInfoData = await this.authUtils.getUserInfo(accessToken);

    // TODO will have to change when we support multiple orgs
    const orgSlug = userInfoData.groups[0].split('/')[1];

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

    return {
      organizationId: organization.id,
      userId: userInfoData.sub,
    };
  }
}
