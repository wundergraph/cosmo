import { z } from 'zod';
import { failure, ok } from './result.js';
const githubTokenResponse = z.object({ value: z.string().min(1) });
export const createCredentials = ({ env, loginToken, fetchImpl = fetch, }) => {
    const ciOidcToken = async ({ audience, gitlabTokenVariable }) => {
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
            return failure('Not signed in. Run `wgc auth login` first.');
        },
    };
};
//# sourceMappingURL=credentials.js.map