import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const info = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), {
    encoding: 'utf8',
  }),
);

const getAccessToken = () => {
  const rootDir = process.cwd();
  // const rootDir = path.parse(process.cwd()).root;
  const dir = path.join(rootDir, 'cosmoConfig.yml');
  if (existsSync(dir)) {
    const data = yaml.load(readFileSync(dir, 'utf8'));
    const loginData = JSON.parse(JSON.stringify(data));
    return loginData.accessToken;
  }
  return null;
};

export const config = {
  baseURL: process.env.COSMO_API_URL || 'https://cosmo-cp.wundergraph.com',
  apiKey: process.env.COSMO_API_KEY,
  kcApiURL: process.env.KC_API_URL || 'http://localhost:8080',
  version: info.version,
};

export const baseHeaders: HeadersInit = {
  'user-agent': `cosmo-cli/${info.version}`,
  authorization: 'Bearer ' + (getAccessToken() || config.apiKey),
};
