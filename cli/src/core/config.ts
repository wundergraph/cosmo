import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import yaml from 'js-yaml';
import envPaths from 'env-paths';

import info from '../../package.json' with { type: 'json' };

const paths = envPaths('cosmo', { suffix: '' });
export const configDir = paths.config;
export const dataDir = paths.data;
export const configFile = join(configDir, 'config.yaml');

export const getLoginDetails = (): { accessToken: string; organizationSlug: string } | null => {
  try {
    const data = yaml.load(readFileSync(configFile, 'utf8'));
    const loginData = JSON.parse(JSON.stringify(data));
    return { accessToken: loginData.accessToken, organizationSlug: loginData.organizationSlug };
  } catch {
    return null;
  }
};

export const config = {
  version: info.version,
  baseURL: process.env.COSMO_API_URL || 'https://cosmo-cp.wundergraph.com',
  // environment var first to allow overriding
  apiKey: process.env.COSMO_API_KEY,
  kcApiURL: process.env.KC_API_URL || 'https://accounts.wundergraph.com/auth',
  webURL: process.env.COSMO_WEB_URL || 'https://cosmo.wundergraph.com',
  kcClientId: process.env.KC_CLIENT_ID || 'cosmo-cli',
  kcRealm: process.env.KC_REALM || 'cosmo',
  cdnURL: process.env.CDN_URL || 'https://cosmo-cdn.wundergraph.com',
  disableUpdateCheck: process.env.DISABLE_UPDATE_CHECK || 'false',
  checkAuthor: process.env.COSMO_VCS_AUTHOR || '',
  checkCommitSha: process.env.COSMO_VCS_COMMIT || '',
  checkBranch: process.env.COSMO_VCS_BRANCH || '',
};

export const getBaseHeaders = (): HeadersInit => {
  return {
    'user-agent': `cosmo-cli/${info.version}`,
    authorization: 'Bearer ' + config.apiKey,
    'cosmo-org-slug': getLoginDetails()?.organizationSlug || '',
  };
};
