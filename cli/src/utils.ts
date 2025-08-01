/* eslint-disable import/named */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  federateSubgraphs,
  FederationResult,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '@wundergraph/composition';
import boxen from 'boxen';
import { buildClientSchema, printSchema } from 'graphql';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { program } from 'commander';
import {
  isValidSubscriptionProtocol,
  isValidWebsocketSubprotocol,
  SubscriptionProtocol,
  WebsocketSubprotocol,
} from '@wundergraph/cosmo-shared';
import { config, configFile } from './core/config.js';
import { KeycloakToken } from './commands/auth/utils.js';

export interface Header {
  key: string;
  value: string;
}

const introspectionQuery = `query IntrospectionQuery {
  __schema {
    queryType {
      name
    }
    mutationType {
      name
    }
    subscriptionType {
      name
    }
    types {
      ...FullType
    }
    directives {
      name
      description
      locations
      args {
        ...InputValue
      }
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args {
      ...InputValue
    }
    type {
      ...TypeRef
    }
    isDeprecated
    deprecationReason
  }
  inputFields {
    ...InputValue
  }
  interfaces {
    ...TypeRef
  }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes {
    ...TypeRef
  }
}

fragment InputValue on __InputValue {
  name
  description
  type {
    ...TypeRef
  }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}`;

const sdlQuery = `
  {
    _service{
      sdl
    }
  }
`;

export const introspectSubgraph = async ({
  subgraphURL,
  additionalHeaders,
  rawIntrospection,
}: {
  subgraphURL: string;
  additionalHeaders: Header[];
  rawIntrospection?: boolean;
}): Promise<{ sdl: string; errorMessage?: string; success: boolean }> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  for (const header of additionalHeaders) {
    headers.append(header.key, header.value);
  }

  const graphql = JSON.stringify({
    query: rawIntrospection ? introspectionQuery : sdlQuery,
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

  const sdl = rawIntrospection ? printSchema(buildClientSchema(data)) : data._service.sdl;

  return {
    success: true,
    sdl,
  };
};

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[], disableResolvabilityValidation?: boolean): FederationResult {
  // @TODO get router compatibility version programmatically
  return federateSubgraphs({ disableResolvabilityValidation, subgraphs, version: ROUTER_COMPATIBILITY_VERSION_ONE });
}

export type ConfigData = Partial<KeycloakToken & { organizationSlug: string; lastUpdateCheck: number }>;

export const readConfigFile = (): ConfigData => {
  if (!existsSync(configFile)) {
    return {};
  }

  const data = yaml.load(readFileSync(configFile, 'utf8'));

  return data ?? {};
};

export const updateConfigFile = (newData: ConfigData) => {
  const existingData = readConfigFile();
  const updatedData = yaml.dump({
    ...existingData,
    ...newData,
  });

  writeFileSync(configFile, updatedData);
};

export const checkForUpdates = async () => {
  try {
    if (config.disableUpdateCheck === 'true') {
      return;
    }

    const currentTime = Date.now();

    const configFileData = readConfigFile();
    if (configFileData.lastUpdateCheck && currentTime - configFileData.lastUpdateCheck < 24 * 60 * 60 * 1000) {
      return;
    }

    const response = await fetch(`https://registry.npmjs.org/wgc/latest`);
    const latestVersion = (await response.json()).version;

    if (config.version === latestVersion) {
      return;
    }

    const message = `Update available! ${pc.red(config.version)} → ${pc.green(latestVersion)}
Changelog: https://github.com/wundergraph/cosmo/releases/tag/wgc@${latestVersion}
Run npm i -g wgc@latest`;

    console.warn(
      boxen(message, {
        padding: 1,
        margin: 1,
        align: 'center',
        borderColor: 'yellow',
        borderStyle: 'round',
      }),
    );

    updateConfigFile({
      lastUpdateCheck: currentTime,
    });
  } catch (e: any) {
    throw new Error(
      `Failed to check for updates. You can disable update check by setting env DISABLE_UPDATE_CHECK=true. ${e.message}`,
    );
  }
};

export const validateSubscriptionProtocols = ({
  subscriptionProtocol,
  websocketSubprotocol,
}: {
  subscriptionProtocol: SubscriptionProtocol;
  websocketSubprotocol: WebsocketSubprotocol;
}) => {
  if (subscriptionProtocol && !isValidSubscriptionProtocol(subscriptionProtocol)) {
    program.error(
      pc.red(
        pc.bold(
          `The subscription protocol '${pc.bold(
            subscriptionProtocol,
          )}' is not valid. Please use one of the following: sse, sse_post, ws.`,
        ),
      ),
    );
  }

  if (websocketSubprotocol) {
    if (subscriptionProtocol && subscriptionProtocol !== 'ws') {
      program.error(
        pc.red(
          pc.bold(
            `The websocket subprotocol '${pc.bold(
              websocketSubprotocol,
            )}' can only be used if the subscription protocol is 'ws'.`,
          ),
        ),
      );
    }
    if (!isValidWebsocketSubprotocol(websocketSubprotocol)) {
      program.error(
        pc.red(
          pc.bold(
            `The websocket subprotocol '${pc.bold(
              websocketSubprotocol,
            )}' is not valid. Please use one of the following: auto, graphql-ws, graphql-transport-ws.`,
          ),
        ),
      );
    }
  }
};
