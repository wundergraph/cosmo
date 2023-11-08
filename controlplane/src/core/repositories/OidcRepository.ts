import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { oidcProviders } from '../../db/schema.js';

export class OidcRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async addOidcProvider(input: { name: string; organizationId: string; endpoint: string; alias: string }) {
    await this.db
      .insert(oidcProviders)
      .values({ name: input.name, organizationId: input.organizationId, endpoint: input.endpoint, alias: input.alias })
      .execute();
  }

  public async getOidcProvider(input: { organizationId: string }) {
    const providers = await this.db
      .select({
        id: oidcProviders.id,
        name: oidcProviders.name,
        endpoint: oidcProviders.endpoint,
        alias: oidcProviders.alias,
      })
      .from(oidcProviders)
      .where(eq(oidcProviders.organizationId, input.organizationId))
      .execute();
    if (providers.length === 0) {
      return undefined;
    }
    // as only one provider per organization
    return providers[0];
  }

  public async deleteOidcProvider(input: { organizationId: string }) {
    await this.db.delete(oidcProviders).where(eq(oidcProviders.organizationId, input.organizationId)).execute();
  }
}
