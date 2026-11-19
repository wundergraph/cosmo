import { Result } from './result.js';
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
export declare const createCredentials: ({ env, loginToken, fetchImpl, }: {
    env: NodeJS.ProcessEnv;
    /** The current `wgc auth login` access token, refreshed when needed. */
    loginToken: () => Promise<string | undefined>;
    fetchImpl?: typeof fetch;
}) => Credentials;
