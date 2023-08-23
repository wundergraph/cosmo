import { readFile } from 'node:fs/promises';

const info = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), {
    encoding: 'utf8',
  }),
);

export const config = {
  baseURL: process.env.COSMO_API_URL || 'https://cosmo-cp.wundergraph.com',
  apiKey: process.env.COSMO_API_KEY,
  version: info.version,
};

export const baseHeaders: HeadersInit = {
  'user-agent': `cosmo-cli/${info.version}`,
  authorization: 'Bearer ' + config.apiKey,
};
