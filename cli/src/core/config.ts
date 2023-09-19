import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import envPaths from 'env-paths';

const info = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), {
    encoding: 'utf8',
  }),
);

const paths = envPaths('cosmo', { suffix: '' });
export const configDir = paths.config;
export const configFile = path.join(configDir, 'config.yaml');

const getAccessToken = () => {
  try {
    const data = yaml.load(readFileSync(configFile, 'utf8'));
    const loginData = JSON.parse(JSON.stringify(data));
    return loginData.accessToken;
  } catch {
    return null;
  }
};

export const config = {
  baseURL: process.env.COSMO_API_URL || 'https://cosmo-cp.wundergraph.com',
  apiKey: getAccessToken() || process.env.COSMO_API_KEY,
  kcApiURL: process.env.KC_API_URL || 'http://localhost:8080',
  kcRealm: process.env.KC_REALM || 'cosmo-cli',
  version: info.version,
};

export const baseHeaders: HeadersInit = {
  'user-agent': `cosmo-cli/${info.version}`,
  authorization: 'Bearer ' + config.apiKey,
};
