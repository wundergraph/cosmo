import { createCredentials, createHubClient } from '@wundergraph/wgc-plugin-sdk';
import type { Credentials, HubClient } from '@wundergraph/wgc-plugin-sdk';
import { checkAuth } from '../commands/auth/utils.js';
import { readConfigFile } from '../utils.js';
import { config } from './config.js';

/** The GitLab `id_tokens` entry wgc reads in GitLab CI when talking to Hub. */
export const hubGitlabTokenVariable = 'HUB_ID_TOKEN';

const loginToken = async (): Promise<string | undefined> => {
  await checkAuth(false);
  return readConfigFile().accessToken;
};

export const createCliCredentials = (): Credentials => createCredentials({ env: process.env, loginToken });

export const createCliHubClient = (credentials: Credentials = createCliCredentials()): HubClient =>
  createHubClient({
    baseUrl: config.hubURL,
    clientVersion: config.version,
    bearer: () =>
      credentials.resolveBearer({ audience: config.hubOidcAudience, gitlabTokenVariable: hubGitlabTokenVariable }),
  });
