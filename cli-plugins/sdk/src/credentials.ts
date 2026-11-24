import { z } from 'zod';
import { failure, failWith, ok, Result } from './result.js';

export type BearerKind = 'ci-oidc' | 'login';

export interface Bearer {
  token: string;
  kind: BearerKind;
}

export interface BearerRequest {
  /** Audience requested from the CI provider's OIDC issuer. */
  audience: string;
  /** Environment variable a GitLab job exposes its `id_tokens` entry under, e.g. `HUB_ID_TOKEN`. */
  gitlabTokenVariable: string;
}

export interface CosmoTokenRequest extends BearerRequest {
  /** Hub's API base, which trades the job's OIDC token for a Cosmo access token at `POST /ci/cosmo-token`. */
  hubUrl: string;
}

/** A Cosmo access token that lets one CI job manage the subgraphs of its graph's namespace until it expires. */
export interface CosmoToken {
  token: string;
  expiresAt: string;
  namespace: string;
}

export interface Credentials {
  /**
   * The CI job's OIDC token when running in GitHub Actions or GitLab CI, else the `wgc auth login` token,
   * once it may be sent to `target`.
   */
  resolveBearer(request: BearerRequest, target: URL): Promise<Result<Bearer>>;
  /** The CI job's OIDC token, or undefined outside a CI job that offers one. */
  ciOidcToken(request: BearerRequest): Promise<Result<string | undefined>>;
  /** In a CI job, the Cosmo access token Hub gives the job for its OIDC token; undefined outside CI. */
  cosmoToken(request: CosmoTokenRequest): Promise<Result<CosmoToken | undefined>>;
}

const githubTokenResponse = z.object({ value: z.string().min(1) });
const cosmoTokenResponse = z.object({ token: z.string().min(1), expiresAt: z.string(), namespace: z.string() });
const hubErrorResponse = z.object({ error: z.string() });

export const createCredentials = ({
  env,
  loginToken,
  authorizeTarget = () => Promise.resolve(ok(undefined)),
  fetchImpl = fetch,
}: {
  env: NodeJS.ProcessEnv;
  /** The current `wgc auth login` access token, refreshed when needed. */
  loginToken: () => Promise<string | undefined>;
  /** Fails when `token` must not be sent to `target`. */
  authorizeTarget?: (token: string, target: URL) => Promise<Result<void>>;
  fetchImpl?: typeof fetch;
}): Credentials => {
  const ciOidcToken = async ({ audience, gitlabTokenVariable }: BearerRequest): Promise<Result<string | undefined>> => {
    const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (requestUrl && requestToken) {
      const url = new URL(requestUrl);
      url.searchParams.set('audience', audience);
      const response = await fetchImpl(url, { headers: { authorization: `bearer ${requestToken}` } });
      if (!response.ok) {
        return failure(`GitHub Actions refused the OIDC token request (HTTP ${response.status}).`);
      }
      const parsed = githubTokenResponse.safeParse(await response.json());
      if (!parsed.success) {
        return failure('GitHub Actions returned an OIDC token response without a token.');
      }
      return ok(parsed.data.value);
    }

    const gitlabToken = env[gitlabTokenVariable];
    if (env.GITLAB_CI && gitlabToken) {
      return ok(gitlabToken);
    }

    return ok(undefined);
  };

  const findBearer = async (request: BearerRequest): Promise<Result<Bearer>> => {
    const ci = await ciOidcToken(request);
    if (!ci.success) {
      return ci;
    }
    if (ci.data) {
      return ok({ token: ci.data, kind: 'ci-oidc' });
    }

    const token = await loginToken();
    if (token) {
      return ok({ token, kind: 'login' });
    }

    if (env.GITHUB_ACTIONS) {
      return failure('No OIDC token is available. Grant the job `permissions: id-token: write`.');
    }
    if (env.GITLAB_CI) {
      return failure(`No OIDC token is available. Add an \`id_tokens\` entry named ${request.gitlabTokenVariable}.`);
    }
    return failWith({
      kind: 'unauthenticated',
      message: 'Not signed in.',
      remediation: 'Run `wgc auth login` first.',
      next: ['wgc auth login'],
    });
  };

  const cosmoToken = async ({ hubUrl, ...request }: CosmoTokenRequest): Promise<Result<CosmoToken | undefined>> => {
    const ci = await ciOidcToken(request);
    if (!ci.success || ci.data === undefined) {
      return ci.success ? ok(undefined) : ci;
    }

    const target = new URL('ci/cosmo-token', hubUrl.endsWith('/') ? hubUrl : `${hubUrl}/`);
    const allowed = await authorizeTarget(ci.data, target);
    if (!allowed.success) {
      return allowed;
    }

    let response: Response;
    try {
      response = await fetchImpl(target, { method: 'POST', headers: { authorization: `Bearer ${ci.data}` } });
    } catch (error: unknown) {
      return failure(`Could not reach Hub at ${target.origin} for a Cosmo access token.`, error as Error);
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const reason = hubErrorResponse.safeParse(body);
      return failure(
        `Hub gave this CI job no Cosmo access token (HTTP ${response.status})` +
          (reason.success ? `: ${reason.data.error}` : '.'),
      );
    }
    const parsed = cosmoTokenResponse.safeParse(body);
    if (!parsed.success) {
      return failure('Hub answered without a Cosmo access token.');
    }
    return ok(parsed.data);
  };

  return {
    ciOidcToken,
    cosmoToken,
    async resolveBearer(request, target) {
      const bearer = await findBearer(request);
      if (!bearer.success) {
        return bearer;
      }
      const allowed = await authorizeTarget(bearer.data.token, target);
      if (!allowed.success) {
        return allowed;
      }
      return bearer;
    },
  };
};
