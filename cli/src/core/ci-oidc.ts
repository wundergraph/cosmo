import { createCredentials, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { config } from './config.js';
import { deployment } from './deployment.js';
import { hubGitlabTokenVariable } from './hub.js';

/** The GitLab `id_tokens` entry wgc reads in GitLab CI when talking to the Cosmo control plane. */
export const cosmoGitlabTokenVariable = 'COSMO_ID_TOKEN';

/**
 * In a CI job without COSMO_API_KEY, sets `config.apiKey`, which `getBaseHeaders` reads, to a credential the job's
 * OIDC identity earns. A Hub deployment's wgc trades the identity at Hub for a Cosmo access token scoped to the graph
 * the repository is connected to; any other wgc sends the job's OIDC token itself. Outside CI it changes nothing.
 */
export const useCiIdentityForCosmo = async ({
  env = process.env,
  fetchImpl = fetch,
  deploymentKind = deployment.kind,
}: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  deploymentKind?: (typeof deployment)['kind'];
} = {}): Promise<Result<'api-key' | 'hub' | 'ci-oidc' | 'none'>> => {
  if (config.apiKey) {
    return ok('api-key');
  }

  const credentials = createCredentials({ env, login: () => Promise.resolve(undefined), fetchImpl });

  if (deploymentKind === 'hub') {
    const cosmoToken = await credentials.cosmoToken({
      audience: config.hubOidcAudience,
      gitlabTokenVariable: hubGitlabTokenVariable,
      hubUrl: config.hubURL,
    });
    if (!cosmoToken.success) {
      return cosmoToken;
    }
    if (!cosmoToken.data) {
      return ok('none');
    }
    config.apiKey = cosmoToken.data.token;
    return ok('hub');
  }

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
