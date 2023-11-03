import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addDays } from 'date-fns';
import AuthUtils from '../auth-utils.js';
import { AuthenticationError, FreeTrialExpiredError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { calLink } from './Authentication.js';

export type AccessTokenAuthContext = {
  userId: string;
  organizationId: string;
  organizationSlug: string;
};

export default class AccessTokenAuthenticator {
  constructor(
    private orgRepo: OrganizationRepository,
    private authUtils: AuthUtils,
  ) {}

  /**
   * Authenticates the user with the given access token. Returns the user's organization ID and user's ID.
   *
   * @param accessToken
   */
  public async authenticate(accessToken: string, organizationSlug: string | null): Promise<AccessTokenAuthContext> {
    const userInfoData = await this.authUtils.getUserInfo(accessToken);

    const orgSlug = organizationSlug || userInfoData.groups[0].split('/')[1];

    const organization = await this.orgRepo.bySlug(orgSlug);

    if (!organization || !organization?.id) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Organization does not exist');
    }

    const isFreeTrialExpired = organization.isFreeTrial && new Date() > addDays(new Date(organization.createdAt), 10);

    if (isFreeTrialExpired) {
      throw new FreeTrialExpiredError(
        EnumStatusCode.ERR_FREE_TRIAL_EXPIRED,
        `Free trial has concluded. Please talk to sales to upgrade your plan.\n${calLink}\n`,
      );
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
      organizationSlug: organization.slug,
      userId: userInfoData.sub,
    };
  }
}
