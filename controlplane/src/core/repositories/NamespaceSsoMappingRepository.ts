import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { namespaces, namespaceSsoProviders } from '../../db/schema.js';
import { traced } from '../tracing.js';
import type { LoginMethod } from '../../types/index.js';

@traced
export class NamespaceSsoMappingRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Returns the set of namespace IDs the given login method is allowed to access
   * within the given organization. Returns `undefined` when the organization has
   * zero mapping rows — i.e. the IdP gate is fully default-open and no filter
   * needs to apply.
   *
   * Semantics:
   * - A namespace with zero rows in namespace_sso_providers is open to all login methods (default-open).
   * - A namespace with one or more rows is restricted to the listed login methods only.
   */
  async allowedNamespaceIds(input: {
    organizationId: string;
    loginMethod: LoginMethod;
  }): Promise<Set<string> | undefined> {
    // API keys are never gated; bail before any DB work.
    if (input.loginMethod.type === 'api-key') {
      return undefined;
    }

    // Single LEFT JOIN: every org namespace appears at least once; restricted
    // namespaces appear once per mapping row, unmapped ones appear once with
    // NULL mapping columns.
    const rows = await this.db
      .select({
        namespaceId: namespaces.id,
        ssoProviderId: namespaceSsoProviders.ssoProviderId,
        isPasswordLogin: namespaceSsoProviders.isPasswordLogin,
      })
      .from(namespaces)
      .leftJoin(namespaceSsoProviders, eq(namespaceSsoProviders.namespaceId, namespaces.id))
      .where(eq(namespaces.organizationId, input.organizationId))
      .execute();

    // If no row in the org has any mapping, the gate is default-open everywhere.
    const isUnmapped = (r: (typeof rows)[number]) => r.ssoProviderId === null && !r.isPasswordLogin;
    if (rows.every((r) => isUnmapped(r))) {
      return undefined;
    }

    // Build the allowed set: open namespaces always; restricted namespaces only
    // when at least one of their mapping rows matches the current login method.
    const allowed = new Set<string>();
    for (const row of rows) {
      if (isUnmapped(row)) {
        allowed.add(row.namespaceId);
        continue;
      }
      const matches =
        input.loginMethod.type === 'sso' ? row.ssoProviderId === input.loginMethod.ssoProviderId : row.isPasswordLogin;
      if (matches) {
        allowed.add(row.namespaceId);
      }
    }
    return allowed;
  }

  getMapping(input: { namespaceId: string }) {
    return this.db
      .select({
        id: namespaceSsoProviders.id,
        namespaceId: namespaceSsoProviders.namespaceId,
        ssoProviderId: namespaceSsoProviders.ssoProviderId,
        isPasswordLogin: namespaceSsoProviders.isPasswordLogin,
      })
      .from(namespaceSsoProviders)
      .where(eq(namespaceSsoProviders.namespaceId, input.namespaceId))
      .execute();
  }

  /**
   * Replaces the mapping for a namespace with the given set of allowed login methods.
   * Empty SSO list + allowPasswordLogin=false → namespace becomes default-open (all rows deleted).
   * Performs delete + inserts inside a transaction.
   */
  async setMapping(input: { namespaceId: string; ssoProviderIds: string[]; allowPasswordLogin: boolean }) {
    await this.db.transaction(async (tx) => {
      await tx.delete(namespaceSsoProviders).where(eq(namespaceSsoProviders.namespaceId, input.namespaceId)).execute();

      const rows: Array<{ namespaceId: string; ssoProviderId: string | null; isPasswordLogin: boolean }> = [];
      for (const ssoProviderId of input.ssoProviderIds) {
        rows.push({ namespaceId: input.namespaceId, ssoProviderId, isPasswordLogin: false });
      }
      if (input.allowPasswordLogin) {
        rows.push({ namespaceId: input.namespaceId, ssoProviderId: null, isPasswordLogin: true });
      }
      if (rows.length > 0) {
        await tx.insert(namespaceSsoProviders).values(rows).execute();
      }
    });
  }
}
