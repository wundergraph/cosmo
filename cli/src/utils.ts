import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { FederationResultContainer, Subgraph, federateSubgraphs } from '@wundergraph/composition';
import boxen from 'boxen';
import { program } from 'commander';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { config, configDir, configFile } from './core/config.js';

export interface Header {
  key: string;
  value: string;
}

export const introspectSubgraph = async ({
  subgraphURL,
  additionalHeaders,
}: {
  subgraphURL: string;
  additionalHeaders: Header[];
}): Promise<{ sdl: string; errorMessage?: string; success: boolean }> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  for (const header of additionalHeaders) {
    headers.append(header.key, header.value);
  }

  const graphql = JSON.stringify({
    query: `
        {
          _service{
            sdl
          }
        }
      `,
    variables: {},
  });

  const response = await fetch(subgraphURL, {
    method: 'POST',
    headers,
    body: graphql,
  });
  if (response.status !== 200) {
    return {
      success: false,
      errorMessage: 'Could not introspect the subgraph.',
      sdl: '',
    };
  }
  const body = await response.json();
  const data = body.data;
  return {
    success: true,
    sdl: data._service.sdl,
  };
};

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[]): FederationResultContainer {
  return federateSubgraphs(subgraphs);
}

// checks if either of access token or api key are present
export function checkAPIKey() {
  if (!config.apiKey) {
    program.error(
      pc.yellow(
        `Not authenticated. Please run ${pc.bold(
          'wgc auth login',
        )} or create an API key and set as environment variable ${pc.bold('COSMO_API_KEY')}.` +
          '\n' +
          'Without an AccessToken/API key, you will not be able to interact with the control plane.',
      ) + '\n',
    );
  }
}

export const checkForUpdates = async () => {
  try {
    if (config.disableUpdateCheck === 'true') {
      return;
    }

    const currentTime = Date.now();

    const data = existsSync(configFile) ? yaml.load(readFileSync(configFile, 'utf8')) ?? {} : {};
    const configFileData = JSON.parse(JSON.stringify(data));
    if (configFileData.lastUpdateCheck && currentTime - configFileData.lastUpdateCheck < 24 * 60 * 60 * 1000) {
      return;
    }

    const response = await fetch(`https://registry.npmjs.org/wgc/latest`);
    const latestVersion = (await response.json()).version;

    if (config.version === latestVersion) {
      return;
    }

    const message = `Update available! ${pc.red(config.version)} → ${pc.green(latestVersion)}
Changelog: https://github.com/wundergraph/cosmo/releases/tag/wgc@${latestVersion}`;

    console.log(
      boxen(message, {
        padding: 1,
        margin: 1,
        align: 'center',
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );

    const newData = yaml.dump({
      ...configFileData,
      lastUpdateCheck: currentTime,
    });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, newData);
  } catch {
    console.log(pc.red('Failed to check for updates'));
  }
};
