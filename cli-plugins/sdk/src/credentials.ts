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

export interface Credentials {
  /** The CI job's OIDC token when running in GitHub Actions or GitLab CI, else the `wgc auth login` token. */
  resolveBearer(request: BearerRequest): Promise<Result<Bearer>>;
  /** The CI job's OIDC token, or undefined outside a CI job that offers one. */
  ciOidcToken(request: BearerRequest): Promise<Result<string | undefined>>;
}

const githubTokenResponse = z.object({ value: z.string().min(1) });

export const createCredentials = ({
  env,
  loginToken,
  fetchImpl = fetch,
}: {
  env: NodeJS.ProcessEnv;
  /** The current `wgc auth login` access token, refreshed when needed. */
  loginToken: () => Promise<string | undefined>;
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

  return {
    ciOidcToken,
    async resolveBearer(request) {
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
    },
  };
};
