import { createCredentials } from '@wundergraph/wgc-plugin-sdk';
import type { Credentials, Login } from '@wundergraph/wgc-plugin-sdk';
import { checkAuth } from '../commands/auth/utils.js';
import { readConfigFile } from '../utils.js';
import { config } from './config.js';
import { instanceRegistry } from './instances.js';

/** The GitLab `id_tokens` entry wgc reads in GitLab CI when talking to Hub. */
export const hubGitlabTokenVariable = 'HUB_ID_TOKEN';

const login = async (): Promise<Login | undefined> => {
  await checkAuth(false);
  const { accessToken, organizationSlug } = readConfigFile();
  if (!accessToken || !organizationSlug) {
    return undefined;
  }
  return { token: accessToken, organizationSlug };
};

export const createCliCredentials = (): Credentials =>
  createCredentials({ env: process.env, login, authorizeTarget: instanceRegistry.authorize });
