import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'pathe';
import yaml from 'js-yaml';
import envPaths from 'env-paths';

const info = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), {
    encoding: 'utf8',
  }),
);

const paths = envPaths('cosmo', { suffix: '' });
export const configDir = paths.config;
export const configFile = join(configDir, 'config.yaml');

const getLoginDetails = (): { accessToken: string; organizationSlug: string } | null => {
  try {
    const data = yaml.load(readFileSync(configFile, 'utf8'));
    const loginData = JSON.parse(JSON.stringify(data));
    return { accessToken: loginData.accessToken, organizationSlug: loginData.organizationSlug };
  } catch {
    return null;
  }
};

export const config = {
  baseURL: process.env.COSMO_API_URL || 'https://cosmo-cp.wundergraph.com',
  // environment var first to allow overriding
  apiKey: process.env.COSMO_API_KEY,
  kcApiURL: process.env.KC_API_URL || 'https://accounts.wundergraph.com/auth',
  webURL: process.env.COSMO_WEB_URL || 'https://cosmo.wundergraph.com',
  kcClientId: process.env.KC_CLIENT_ID || 'cosmo-cli',
  kcRealm: process.env.KC_REALM || 'cosmo',
  cdnURL: process.env.CDN_URL || 'https://cosmo-cdn.wundergraph.com',
  version: info.version,
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
