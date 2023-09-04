import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';

export type ApiKeyAuthContext = {
  organizationId: string;
};

export default class ApiKeyAuthenticator {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

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
    /**
     * Update the last used at timestamp.
     */
    await this.db.update(schema.apiKeys).set({
      lastUsedAt: new Date(),
    });

    return {
      organizationId: apiKeyModel.organizationId,
    };
  }
}
