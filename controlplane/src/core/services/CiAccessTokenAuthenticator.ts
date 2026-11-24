import { hkdfSync } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { traced } from '../tracing.js';
import type { ApiKeyAuthContext } from './ApiKeyAuthenticator.js';
import { RBACEvaluator } from './RBACEvaluator.js';

/** Starts every CI access token, so the control plane tells it apart from an API key and a user's access token. */
export const ciAccessTokenPrefix = 'cosmo_ci_';

/** How long a CI access token lasts. It covers one CI job, and nothing can extend it. */
export const ciAccessTokenLifetimeSeconds = 10 * 60;

const issuer = 'cosmo-controlplane';
const audience = 'cosmo:ci-access-token';

const claims = z.object({
  sub: z.string().min(1),
  organization_id: z.string().uuid(),
  namespace_id: z.string().uuid(),
  created_by_id: z.string().uuid(),
  created_by_name: z.string(),
});

/** What a CI access token lets one job of one repository do: manage the subgraphs of one namespace. */
export interface CiAccessTokenGrant {
  organizationId: string;
  namespaceId: string;
  /** The repository whose job the token is for, with its host, e.g. `github.com/acme/shop`. */
  repository: string;
  /** The user behind the credential that asked for the token. Actions taken with the token are recorded for them. */
  createdById: string;
  createdByName: string;
}

/**
 * Issues and verifies CI access tokens: short-lived tokens a CI job uses in place of an API key. Only a credential that
 * may itself create subgraphs in a namespace gets one for it, so a token never grants more than its issuer holds.
 */
@traced
export default class CiAccessTokenAuthenticator {
  readonly #key: Uint8Array;

  constructor(
    secret: string,
    private orgRepo: OrganizationRepository,
  ) {
    // A key of its own, so no other token signed with the control plane secret verifies as a CI access token.
    this.#key = new Uint8Array(hkdfSync('sha256', secret, '', 'WunderGraph Cosmo CI Access Token Key', 32));
  }

  public async issue(grant: CiAccessTokenGrant): Promise<{ token: string; expiresAt: Date }> {
    const issuedAt = Math.trunc(Date.now() / 1000);
    const expiresAt = issuedAt + ciAccessTokenLifetimeSeconds;
    const jwt = await new SignJWT({
      organization_id: grant.organizationId,
      namespace_id: grant.namespaceId,
      created_by_id: grant.createdById,
      created_by_name: grant.createdByName,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(grant.repository)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#key);

    return { token: ciAccessTokenPrefix + jwt, expiresAt: new Date(expiresAt * 1000) };
  }

  public async authenticate(token: string): Promise<ApiKeyAuthContext> {
    let payload: z.infer<typeof claims>;
    try {
      const verified = await jwtVerify(token.slice(ciAccessTokenPrefix.length), this.#key, {
        issuer,
        audience,
        algorithms: ['HS256'],
        requiredClaims: ['exp'],
      });
      payload = claims.parse(verified.payload);
    } catch (error: unknown) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        error instanceof errors.JWTExpired ? 'The CI access token is expired' : 'The CI access token is invalid',
      );
    }

    const organization = await this.orgRepo.byId(payload.organization_id);
    if (!organization) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Organization does not exist');
    }

    return {
      auth: 'api_key',
      userId: payload.created_by_id,
      userDisplayName: payload.created_by_name,
      apiKeyName: `ci:${payload.sub}`,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationDeactivated: !!organization.deactivation,
      rbac: new RBACEvaluator(
        [
          {
            groupId: `ci:${payload.sub}`,
            name: 'ci',
            description: `CI jobs of ${payload.sub}`,
            builtin: true,
            kcGroupId: null,
            rules: [{ role: 'subgraph-admin', namespaces: [payload.namespace_id], resources: [] }],
          },
        ],
        payload.created_by_id,
        true,
      ),
      loginMethod: { type: 'api-key' },
    };
  }
}
