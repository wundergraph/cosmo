import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { RBACEvaluator } from './RBACEvaluator.js';

export type ApiKeyAuthContext = {
  auth: 'api_key';
  organizationId: string;
  organizationSlug: string;
  organizationDeactivated: boolean;
  userId: string;
  userDisplayName: string;
  apiKeyName: string;
  rbac: RBACEvaluator;
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

    /**
     * Update the last used at timestamp.
     */
    await this.db
      .update(schema.apiKeys)
      .set({
        lastUsedAt: new Date(),
      })
      .where(eq(schema.apiKeys.id, apiKeyModel.id));

    const organizationDeactivated = !!organization.deactivation;
    let rbac: RBACEvaluator;
    if (apiKeyModel.groupId) {
      const keyGroup = await this.orgRepo.getOrganizationGroup({
        organizationId: organization.id,
        groupId: apiKeyModel.groupId,
      });

      rbac = new RBACEvaluator(keyGroup ? [keyGroup] : [], apiKeyModel.userId, true);
    } else {
      rbac = new RBACEvaluator([], apiKeyModel.userId, true);
    }

    return {
      auth: 'api_key',
      userId: apiKeyModel.userId,
      userDisplayName: apiKeyModel.user.email,
      apiKeyName: apiKeyModel.name,
      organizationId: apiKeyModel.organizationId,
      organizationSlug: organization.slug,
      organizationDeactivated,
      rbac,
    };
  }
}
