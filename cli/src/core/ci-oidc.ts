import { createCredentials, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { config } from './config.js';

/** The GitLab `id_tokens` entry wgc reads in GitLab CI when talking to the Cosmo control plane. */
export const cosmoGitlabTokenVariable = 'COSMO_ID_TOKEN';

/**
 * In a CI job without COSMO_API_KEY, makes the job's OIDC token the control plane Bearer by setting
 * `config.apiKey`, which `getBaseHeaders` and `checkAuth` read. Outside CI it changes nothing.
 */
export const useCiOidcTokenForCosmo = async ({
  env = process.env,
  fetchImpl = fetch,
}: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): Promise<Result<'api-key' | 'ci-oidc' | 'none'>> => {
  if (config.apiKey) {
    return ok('api-key');
  }

  const credentials = createCredentials({ env, loginToken: () => Promise.resolve(undefined), fetchImpl });
  const token = await credentials.ciOidcToken({
    audience: env.COSMO_OIDC_AUDIENCE || 'cosmo',
    gitlabTokenVariable: cosmoGitlabTokenVariable,
  });
  if (!token.success) {
    return token;
  }
  if (!token.data) {
    return ok('none');
  }

  config.apiKey = token.data;
  return ok('ci-oidc');
};
