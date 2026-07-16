import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { namespaces, namespaceLoginMethods, organizationLoginMethods } from '../../db/schema.js';
import { traced } from '../tracing.js';
import { loginMethodMatchesRow } from '../util.js';
import type { LoginMethod } from '../../types/index.js';

@traced
export class OrganizationLoginMethodRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Whether the given login method may access the organization.
   * - API keys are never gated.
   * - An org with zero rows is default-open (every method allowed).
   * - Otherwise only the configured methods are allowed.
   */
  async isLoginMethodAllowed(input: { organizationId: string; loginMethod: LoginMethod }): Promise<boolean> {
    if (input.loginMethod.type === 'api-key') {
      return true;
    }

    const rows = await this.db
      .select({
        ssoProviderId: organizationLoginMethods.ssoProviderId,
        isPasswordLogin: organizationLoginMethods.isPasswordLogin,
        isGoogleLogin: organizationLoginMethods.isGoogleLogin,
        isGithubLogin: organizationLoginMethods.isGithubLogin,
      })
      .from(organizationLoginMethods)
      .where(eq(organizationLoginMethods.organizationId, input.organizationId))
      .execute();

    if (rows.length === 0) {
      return true;
    }

    return rows.some((r) => loginMethodMatchesRow(input.loginMethod, r));
  }

  /** Returns the org's allowed-method config for the settings UI. */
  async getAllowedLoginMethods(input: { organizationId: string }): Promise<{
    allowPasswordLogin: boolean;
    allowGoogleLogin: boolean;
    allowGithubLogin: boolean;
    allowedSsoProviderIds: string[];
    isRestricted: boolean;
  }> {
    const rows = await this.db
      .select({
        ssoProviderId: organizationLoginMethods.ssoProviderId,
        isPasswordLogin: organizationLoginMethods.isPasswordLogin,
        isGoogleLogin: organizationLoginMethods.isGoogleLogin,
        isGithubLogin: organizationLoginMethods.isGithubLogin,
      })
      .from(organizationLoginMethods)
      .where(eq(organizationLoginMethods.organizationId, input.organizationId))
      .execute();

    const result = {
      allowPasswordLogin: false,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      allowedSsoProviderIds: [] as string[],
      isRestricted: rows.length > 0,
    };
    for (const row of rows) {
      if (row.ssoProviderId) {
        result.allowedSsoProviderIds.push(row.ssoProviderId);
      }
      if (row.isPasswordLogin) {
        result.allowPasswordLogin = true;
      }
      if (row.isGoogleLogin) {
        result.allowGoogleLogin = true;
      }
      if (row.isGithubLogin) {
        result.allowGithubLogin = true;
      }
    }
    return result;
  }

  /**
   * Replaces the org's allowed login methods and reconciles namespace mappings
   * so they stay within the new allow-list, in a single transaction.
   *
   * Passing all-false flags and an empty provider list clears the restriction
   * (the org returns to default-open) and imposes no bound on namespaces.
   */
  async setAllowedLoginMethods(input: {
    organizationId: string;
    allowPasswordLogin: boolean;
    allowGoogleLogin: boolean;
    allowGithubLogin: boolean;
    allowedSsoProviderIds: string[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(organizationLoginMethods)
        .where(eq(organizationLoginMethods.organizationId, input.organizationId))
        .execute();

      const rows: Array<{
        organizationId: string;
        ssoProviderId?: string | null;
        isPasswordLogin?: boolean;
        isGoogleLogin?: boolean;
        isGithubLogin?: boolean;
      }> = [];
      for (const ssoProviderId of input.allowedSsoProviderIds) {
        rows.push({ organizationId: input.organizationId, ssoProviderId });
      }
      if (input.allowPasswordLogin || input.allowGoogleLogin || input.allowGithubLogin) {
        rows.push({
          organizationId: input.organizationId,
          isPasswordLogin: input.allowPasswordLogin,
          isGoogleLogin: input.allowGoogleLogin,
          isGithubLogin: input.allowGithubLogin,
        });
      }
      if (rows.length > 0) {
        await tx.insert(organizationLoginMethods).values(rows).execute();
      }

      // Unrestricted (empty allow-list) imposes no bound on namespaces.
      if (rows.length === 0) {
        return;
      }

      const orgNamespaceIds = tx
        .select({ id: namespaces.id })
        .from(namespaces)
        .where(eq(namespaces.organizationId, input.organizationId));

      // Drop namespace SSO rows whose provider is no longer allowed.
      const ssoConditions = [
        inArray(namespaceLoginMethods.namespaceId, orgNamespaceIds),
        isNotNull(namespaceLoginMethods.ssoProviderId),
      ];
      if (input.allowedSsoProviderIds.length > 0) {
        ssoConditions.push(notInArray(namespaceLoginMethods.ssoProviderId, input.allowedSsoProviderIds));
      }
      await tx
        .delete(namespaceLoginMethods)
        .where(and(...ssoConditions))
        .execute();

      // Reconcile each namespace built-in row (ssoProviderId IS NULL) against the new
      // org allow-list: a row keeps only the methods that are still allowed. This runs
      // only when an admin tightens the org (rare) over the org's restricted
      // namespaces (few), so a simple read-then-write per row is clear and sufficient.
      const builtinRows = await tx
        .select({
          id: namespaceLoginMethods.id,
          isPasswordLogin: namespaceLoginMethods.isPasswordLogin,
          isGoogleLogin: namespaceLoginMethods.isGoogleLogin,
          isGithubLogin: namespaceLoginMethods.isGithubLogin,
        })
        .from(namespaceLoginMethods)
        .where(
          and(inArray(namespaceLoginMethods.namespaceId, orgNamespaceIds), isNull(namespaceLoginMethods.ssoProviderId)),
        )
        .execute();

      for (const row of builtinRows) {
        const next = {
          isPasswordLogin: row.isPasswordLogin && input.allowPasswordLogin,
          isGoogleLogin: row.isGoogleLogin && input.allowGoogleLogin,
          isGithubLogin: row.isGithubLogin && input.allowGithubLogin,
        };

        const unchanged =
          next.isPasswordLogin === row.isPasswordLogin &&
          next.isGoogleLogin === row.isGoogleLogin &&
          next.isGithubLogin === row.isGithubLogin;
        if (unchanged) {
          continue;
        }

        if (!next.isPasswordLogin && !next.isGoogleLogin && !next.isGithubLogin) {
          // No allowed method remains, so the namespace falls back to default-open.
          await tx.delete(namespaceLoginMethods).where(eq(namespaceLoginMethods.id, row.id)).execute();
        } else {
          await tx.update(namespaceLoginMethods).set(next).where(eq(namespaceLoginMethods.id, row.id)).execute();
        }
      }
    });
  }
}
