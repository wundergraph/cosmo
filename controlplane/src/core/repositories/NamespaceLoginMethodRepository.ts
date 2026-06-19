import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, SQL } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { namespaces, namespaceLoginMethods } from '../../db/schema.js';
import { traced } from '../tracing.js';
import { applyIdpNamespaceGate, loginMethodMatchesRow } from '../util.js';
import type { LoginMethod, NamespaceAccess } from '../../types/index.js';
import type { RBACEvaluator } from '../services/RBACEvaluator.js';

@traced
export class NamespaceLoginMethodRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Evaluates which namespaces the given login method may access within the org.
   *
   * Semantics:
   * - A namespace with zero rows in namespace_login_methods is open to all login methods (default-open).
   * - A namespace with one or more rows is restricted to the listed login methods only.
   *
   * Returns {@link NamespaceAccess}: `all` when the org has no mapping rows (or
   * the login is an API key, which is never gated), `none` when the login method
   * matches no namespace, otherwise `restricted` with the reachable namespace ids.
   */
  async allowedNamespaces(input: { organizationId: string; loginMethod: LoginMethod }): Promise<NamespaceAccess> {
    // API keys are never gated; bail before any DB work.
    if (input.loginMethod.type === 'api-key') {
      return { kind: 'all' };
    }

    // Single LEFT JOIN: every org namespace appears at least once; restricted
    // namespaces appear once per mapping row, unmapped ones appear once with
    // NULL mapping columns.
    const rows = await this.db
      .select({
        namespaceId: namespaces.id,
        ssoProviderId: namespaceLoginMethods.ssoProviderId,
        isPasswordLogin: namespaceLoginMethods.isPasswordLogin,
        isGoogleLogin: namespaceLoginMethods.isGoogleLogin,
        isGithubLogin: namespaceLoginMethods.isGithubLogin,
      })
      .from(namespaces)
      .leftJoin(namespaceLoginMethods, eq(namespaceLoginMethods.namespaceId, namespaces.id))
      .where(eq(namespaces.organizationId, input.organizationId))
      .execute();

    // If no row in the org has any mapping, the gate is default-open everywhere.
    const isUnmapped = (r: (typeof rows)[number]) =>
      r.ssoProviderId === null && !r.isPasswordLogin && !r.isGoogleLogin && !r.isGithubLogin;
    if (rows.every((r) => isUnmapped(r))) {
      return { kind: 'all' };
    }

    const { loginMethod } = input;

    // Build the allowed set: open namespaces always; restricted namespaces only
    // when at least one of their mapping rows matches the current login method.
    const namespaceIds = new Set<string>();
    for (const row of rows) {
      if (isUnmapped(row) || loginMethodMatchesRow(loginMethod, row)) {
        namespaceIds.add(row.namespaceId);
      }
    }

    return namespaceIds.size === 0 ? { kind: 'none' } : { kind: 'restricted', namespaceIds };
  }

  /**
   * Returns one entry per namespace in the org that has at least one mapping row
   * (i.e. is restricted). Namespaces with no rows (default-open) are omitted.
   *
   * When `rbac` is provided, results are limited to the namespaces its IdP gate
   * allows, so callers only ever see namespaces they can access.
   */
  async listMappings(input: { organizationId: string; rbac?: RBACEvaluator }): Promise<
    {
      namespaceId: string;
      allowedSsoProviderIds: string[];
      allowPasswordLogin: boolean;
      allowGoogleLogin: boolean;
      allowGithubLogin: boolean;
    }[]
  > {
    const conditions: (SQL<unknown> | undefined)[] = [eq(namespaces.organizationId, input.organizationId)];
    if (!applyIdpNamespaceGate(input.rbac, namespaces.id, conditions)) {
      return [];
    }

    const rows = await this.db
      .select({
        namespaceId: namespaceLoginMethods.namespaceId,
        ssoProviderId: namespaceLoginMethods.ssoProviderId,
        isPasswordLogin: namespaceLoginMethods.isPasswordLogin,
        isGoogleLogin: namespaceLoginMethods.isGoogleLogin,
        isGithubLogin: namespaceLoginMethods.isGithubLogin,
      })
      .from(namespaceLoginMethods)
      .innerJoin(namespaces, eq(namespaces.id, namespaceLoginMethods.namespaceId))
      .where(and(...conditions))
      .execute();

    type Entry = {
      allowedSsoProviderIds: string[];
      allowPasswordLogin: boolean;
      allowGoogleLogin: boolean;
      allowGithubLogin: boolean;
    };
    const byNamespace = new Map<string, Entry>();
    for (const row of rows) {
      const entry = byNamespace.get(row.namespaceId) ?? {
        allowedSsoProviderIds: [],
        allowPasswordLogin: false,
        allowGoogleLogin: false,
        allowGithubLogin: false,
      };
      if (row.ssoProviderId) {
        entry.allowedSsoProviderIds.push(row.ssoProviderId);
      }
      if (row.isPasswordLogin) {
        entry.allowPasswordLogin = true;
      }
      if (row.isGoogleLogin) {
        entry.allowGoogleLogin = true;
      }
      if (row.isGithubLogin) {
        entry.allowGithubLogin = true;
      }
      byNamespace.set(row.namespaceId, entry);
    }

    return Array.from(byNamespace, ([namespaceId, entry]) => ({ namespaceId, ...entry }));
  }

  /**
   * Replaces the org's namespace mappings in a single transaction: every
   * namespace the caller can access (per the `rbac` IdP gate) has its rows
   * cleared, then the provided `mappings` are inserted. Namespaces not in
   * `mappings` therefore become default-open. Namespaces the caller can't access
   * are left untouched.
   *
   * Each SSO provider is its own row; password/google/github share a single
   * "built-in methods" row.
   */
  async setMappings(input: {
    organizationId: string;
    rbac?: RBACEvaluator;
    mappings: {
      namespaceId: string;
      ssoProviderIds: string[];
      allowPasswordLogin: boolean;
      allowGoogleLogin: boolean;
      allowGithubLogin: boolean;
    }[];
  }) {
    await this.db.transaction(async (tx) => {
      // Clear existing rows only for the namespaces the caller can access — NOT
      // a blanket org-wide delete. A caller whose own login is IdP-gated only
      // sees (and submits) a subset of namespaces, so wiping everything would
      // destroy the mappings of namespaces they can't see or manage (e.g. a
      // staging-IdP session clearing prod's restrictions). For an ungated caller
      // the gate adds no condition, so this still clears every org namespace.
      // `none` (gate locks out everything) → wipe nothing.
      const conditions: (SQL<unknown> | undefined)[] = [eq(namespaces.organizationId, input.organizationId)];
      if (applyIdpNamespaceGate(input.rbac, namespaces.id, conditions)) {
        const accessibleNamespaces = await tx
          .select({ id: namespaces.id })
          .from(namespaces)
          .where(and(...conditions))
          .execute();
        const accessibleNamespaceIds = accessibleNamespaces.map((n) => n.id);
        if (accessibleNamespaceIds.length > 0) {
          await tx
            .delete(namespaceLoginMethods)
            .where(inArray(namespaceLoginMethods.namespaceId, accessibleNamespaceIds))
            .execute();
        }
      }

      const rows: Array<{
        namespaceId: string;
        ssoProviderId?: string | null;
        isPasswordLogin?: boolean;
        isGoogleLogin?: boolean;
        isGithubLogin?: boolean;
      }> = [];
      for (const mapping of input.mappings) {
        for (const ssoProviderId of mapping.ssoProviderIds) {
          rows.push({ namespaceId: mapping.namespaceId, ssoProviderId });
        }
        if (mapping.allowPasswordLogin || mapping.allowGoogleLogin || mapping.allowGithubLogin) {
          rows.push({
            namespaceId: mapping.namespaceId,
            isPasswordLogin: mapping.allowPasswordLogin,
            isGoogleLogin: mapping.allowGoogleLogin,
            isGithubLogin: mapping.allowGithubLogin,
          });
        }
      }
      if (rows.length > 0) {
        await tx.insert(namespaceLoginMethods).values(rows).execute();
      }
    });
  }
}
