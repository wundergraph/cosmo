import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { oidcProviders } from '../../db/schema.js';
import { traced } from '../tracing.js';

const baseProviderColumns = {
  id: oidcProviders.id,
  name: oidcProviders.name,
  endpoint: oidcProviders.endpoint,
  alias: oidcProviders.alias,
  organizationId: oidcProviders.organizationId,
  createdAt: oidcProviders.createdAt,
} as const;

@traced
export class OidcRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async addOidcProvider(input: { name: string; organizationId: string; endpoint: string; alias: string }) {
    await this.db
      .insert(oidcProviders)
      .values({
        name: input.name,
        organizationId: input.organizationId,
        endpoint: input.endpoint,
        alias: input.alias,
      })
      .execute();
  }

  public listOidcProvidersByOrganizationId(input: { organizationId: string }) {
    return this.db
      .select(baseProviderColumns)
      .from(oidcProviders)
      .where(eq(oidcProviders.organizationId, input.organizationId))
      .orderBy(oidcProviders.createdAt)
      .execute();
  }

  public async getOidcProviderById(input: { id: string; organizationId: string }) {
    const rows = await this.db
      .select(baseProviderColumns)
      .from(oidcProviders)
      .where(and(eq(oidcProviders.id, input.id), eq(oidcProviders.organizationId, input.organizationId)))
      .limit(1)
      .execute();
    return rows[0];
  }

  public async getOidcProviderByAlias(input: { alias: string; organizationId: string }) {
    const rows = await this.db
      .select(baseProviderColumns)
      .from(oidcProviders)
      .where(and(eq(oidcProviders.alias, input.alias), eq(oidcProviders.organizationId, input.organizationId)))
      .limit(1)
      .execute();
    return rows[0];
  }

  /**
   * Resolves a provider by its globally-unique alias without org scoping. Only use
   * when the alias comes from a trusted source (e.g. a session row), never raw user input.
   */
  public async getOidcProviderByAliasUnscoped(input: { alias: string }) {
    const rows = await this.db
      .select(baseProviderColumns)
      .from(oidcProviders)
      .where(eq(oidcProviders.alias, input.alias))
      .limit(1)
      .execute();
    return rows[0];
  }

  /**
   * Returns the org's first OIDC provider. Used by cross-feature flows (group
   * sync, user/org management) that only need to know whether the org has SSO
   * configured, not which specific provider.
   */
  public async getOidcProvider(input: { organizationId: string }) {
    const rows = await this.listOidcProvidersByOrganizationId(input);
    return rows[0];
  }

  public async deleteOidcProviderById(input: { id: string; organizationId: string }) {
    await this.db
      .delete(oidcProviders)
      .where(and(eq(oidcProviders.id, input.id), eq(oidcProviders.organizationId, input.organizationId)))
      .execute();
  }
}
