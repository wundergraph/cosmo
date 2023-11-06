import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addDays } from 'date-fns';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { AuthenticationError, FreeTrialExpiredError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { calLink } from './Authentication.js';

export type ApiKeyAuthContext = {
  organizationId: string;
  organizationSlug: string;
  hasWriteAccess: boolean;
  isAdmin: boolean;
};

export default class ApiKeyAuthenticator {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private orgRepo: OrganizationRepository,
  ) {}

  /**
   * Authenticates the user with the given api key. Returns the user's organization ID.
   * Due to authenticity of the JWT we can the user has access to the organization.
   *
   * @param apiKey
   */
  public async authenticate(apiKey: string): Promise<ApiKeyAuthContext> {
    const apiKeyModel = await this.db.query.apiKeys.findFirst({
      where: eq(schema.apiKeys.key, apiKey),
      with: {
        user: true,
      },
    });

    if (!apiKeyModel || !apiKeyModel.user) {
      throw new Error('Invalid api key');
    }

    if (apiKeyModel?.expiresAt && apiKeyModel.expiresAt < new Date()) {
      throw new Error('Api key is expired');
    }

    const organization = await this.orgRepo.byId(apiKeyModel.organizationId);
    if (!organization) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Organization does not exist');
    }

    const isFreeTrialExpired = organization.isFreeTrial && new Date() > addDays(new Date(organization.createdAt), 10);

    if (isFreeTrialExpired) {
      throw new FreeTrialExpiredError(
        EnumStatusCode.ERR_FREE_TRIAL_EXPIRED,
        `Free trial has concluded. Please talk to sales to upgrade your plan.\n${calLink}\n`,
      );
    }

    /**
     * Update the last used at timestamp.
     */
    await this.db
      .update(schema.apiKeys)
      .set({
        lastUsedAt: new Date(),
      })
      .where(eq(schema.apiKeys.id, apiKeyModel.id));

    return {
      organizationId: apiKeyModel.organizationId,
      organizationSlug: organization.slug,
      // sending true as the api key has admin permissions
      isAdmin: true,
      hasWriteAccess: true
    };
  }
}
