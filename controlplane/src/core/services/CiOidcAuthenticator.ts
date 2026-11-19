import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify, JWTPayload, JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { AuthenticationError } from '../errors/errors.js';
import {
  CiProvider,
  CiTrustedRepositoryDTO,
  CiTrustedRepositoryRepository,
} from '../repositories/CiTrustedRepositoryRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { traced } from '../tracing.js';
import type { ApiKeyAuthContext } from './ApiKeyAuthenticator.js';
import { RBACEvaluator } from './RBACEvaluator.js';

export const githubActionsIssuer = 'https://token.actions.githubusercontent.com';
export const gitlabComIssuer = 'https://gitlab.com';
export const defaultCiOidcAudience = 'cosmo';

export interface CiIssuer {
  provider: CiProvider;
  issuer: string;
  jwksUri: string;
}

/**
 * The CI token issuers the control plane accepts: GitHub Actions and the given GitLab instances.
 */
export function ciIssuers(gitlabIssuers: string[]): CiIssuer[] {
  return [
    { provider: 'github', issuer: githubActionsIssuer, jwksUri: `${githubActionsIssuer}/.well-known/jwks` },
    ...gitlabIssuers.map((gitlabIssuer): CiIssuer => {
      const issuer = gitlabIssuer.replace(/\/+$/, '');
      return { provider: 'gitlab', issuer, jwksUri: `${issuer}/oauth/discovery/keys` };
    }),
  ];
}

export interface CiOidcOptions {
  audience: string;
  issuers: CiIssuer[];
  /** Also require the WunderGraph GitHub app on the account that owns a GitHub repository. */
  requireGithubAppInstallation: boolean;
  /** The keys an issuer signs its tokens with. Fetched from the issuer's JWKS endpoint unless given. */
  keysOf?: (issuer: CiIssuer) => JWTVerifyGetKey;
}

/** The CI job a verified token was issued to. */
type CiJob =
  | { provider: 'github'; issuer: string; repository: string; ref: string; repositoryOwnerId: number }
  | { provider: 'gitlab'; issuer: string; repository: string; ref: string };

const githubClaims = z.object({
  repository: z.string().min(1),
  repository_owner_id: z.coerce.number().int().positive(),
  ref: z.string().min(1),
});

const gitlabClaims = z.object({
  project_path: z.string().min(1),
  ref: z.string().min(1),
  ref_type: z.enum(['branch', 'tag']),
});

const gitlabRefPrefix = { branch: 'refs/heads/', tag: 'refs/tags/' } as const;

function ciJobFromClaims(issuer: CiIssuer, claims: JWTPayload): CiJob | undefined {
  if (issuer.provider === 'github') {
    const parsed = githubClaims.safeParse(claims);
    if (!parsed.success) {
      return undefined;
    }
    return {
      provider: 'github',
      issuer: issuer.issuer,
      repository: parsed.data.repository.toLowerCase(),
      ref: parsed.data.ref,
      repositoryOwnerId: parsed.data.repository_owner_id,
    };
  }

  const parsed = gitlabClaims.safeParse(claims);
  if (!parsed.success) {
    return undefined;
  }
  // GitLab reports a bare branch or tag name. Ref filters are written against full git refs.
  const ref = parsed.data.ref.startsWith('refs/')
    ? parsed.data.ref
    : gitlabRefPrefix[parsed.data.ref_type] + parsed.data.ref;
  return { provider: 'gitlab', issuer: issuer.issuer, repository: parsed.data.project_path.toLowerCase(), ref };
}

/**
 * Whether the git ref satisfies the filter. `*` in the filter stands for any run of characters.
 */
export function refMatchesFilter(ref: string, filter: string): boolean {
  const pattern = filter
    .split('*')
    .map((literal) => literal.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}$`).test(ref);
}

function rejectedTokenMessage(error: unknown): string {
  if (error instanceof errors.JWTExpired) {
    return 'The CI OIDC token is expired';
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    return `The CI OIDC token has a missing or unexpected "${error.claim}" claim`;
  }
  return 'The CI OIDC token could not be verified';
}

/**
 * Authenticates a CI job by the OIDC token its CI provider issued to it. The job acts for the organization
 * that trusts the job's repository, with the permissions of the group the organization chose for it.
 */
@traced
export default class CiOidcAuthenticator {
  readonly #issuers: ReadonlyMap<string, CiIssuer>;
  readonly #remoteKeys = new Map<string, JWTVerifyGetKey>();

  constructor(
    private trustedRepositoryRepo: CiTrustedRepositoryRepository,
    private orgRepo: OrganizationRepository,
    private options: CiOidcOptions,
  ) {
    this.#issuers = new Map(options.issuers.map((issuer) => [issuer.issuer, issuer]));
  }

  /**
   * The CI issuer the token claims to come from. The claim is unverified and only selects the keys
   * `authenticate` verifies the token against.
   */
  public issuerOf(token: string): CiIssuer | undefined {
    try {
      const { iss } = decodeJwt(token);
      return iss === undefined ? undefined : this.#issuers.get(iss);
    } catch {
      return undefined;
    }
  }

  public async authenticate(
    token: string,
    issuer: CiIssuer,
    organizationSlug: string | null,
  ): Promise<ApiKeyAuthContext> {
    const job = await this.verify(token, issuer);
    const trusted = await this.trustedRepositoryFor(job, organizationSlug);

    if (trusted.refFilter !== undefined && !refMatchesFilter(job.ref, trusted.refFilter)) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        `The ref ${job.ref} of repository ${job.repository} is not trusted. Trusted refs: ${trusted.refFilter}`,
      );
    }

    if (job.provider === 'github' && this.options.requireGithubAppInstallation) {
      const isInstalled = await this.trustedRepositoryRepo.isGithubAppInstalledOn(job.repositoryOwnerId);
      if (!isInstalled) {
        throw new AuthenticationError(
          EnumStatusCode.ERROR_NOT_AUTHENTICATED,
          `The WunderGraph GitHub app is not installed for the owner of repository ${job.repository}`,
        );
      }
    }

    const organization = await this.orgRepo.byId(trusted.organizationId);
    if (!organization) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Organization does not exist');
    }

    const group = await this.orgRepo.getOrganizationGroup({
      organizationId: organization.id,
      groupId: trusted.groupId,
    });
    // An evaluator without a group would treat the job as a legacy API key with admin access.
    if (!group) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        `The group of trusted repository ${job.repository} does not exist`,
      );
    }

    return {
      auth: 'api_key',
      userId: trusted.createdById,
      userDisplayName: trusted.createdByEmail,
      apiKeyName: `ci:${job.provider}:${job.repository}`,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationDeactivated: !!organization.deactivation,
      rbac: new RBACEvaluator([group], trusted.createdById, true),
      loginMethod: { type: 'api-key' },
    };
  }

  private async verify(token: string, issuer: CiIssuer): Promise<CiJob> {
    let claims: JWTPayload;
    try {
      const verified = await jwtVerify(token, this.keysOf(issuer), {
        issuer: issuer.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'aud'],
      });
      claims = verified.payload;
    } catch (error: unknown) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, rejectedTokenMessage(error));
    }

    const job = ciJobFromClaims(issuer, claims);
    if (!job) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        'The CI OIDC token does not name the repository and ref of its job',
      );
    }
    return job;
  }

  private keysOf(issuer: CiIssuer): JWTVerifyGetKey {
    if (this.options.keysOf) {
      return this.options.keysOf(issuer);
    }

    let keys = this.#remoteKeys.get(issuer.issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(issuer.jwksUri));
      this.#remoteKeys.set(issuer.issuer, keys);
    }
    return keys;
  }

  private async trustedRepositoryFor(job: CiJob, organizationSlug: string | null): Promise<CiTrustedRepositoryDTO> {
    const everyTrust = await this.trustedRepositoryRepo.byRepository({
      issuer: job.issuer,
      repository: job.repository,
    });
    const candidates = organizationSlug
      ? everyTrust.filter((trusted) => trusted.organizationSlug === organizationSlug)
      : everyTrust;

    if (candidates.length === 0) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        `Repository ${job.repository} is not a trusted CI repository`,
      );
    }
    if (candidates.length > 1) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        `Repository ${job.repository} is trusted by several organizations. Name one with the cosmo-org-slug header`,
      );
    }
    return candidates[0];
  }
}
