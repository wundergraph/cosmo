/* eslint-disable import/named */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  CompositionOptions,
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
import { SubgraphPublishStats } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { config, configDir, configFile } from './core/config.js';
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
export function composeSubgraphs(subgraphs: Subgraph[], options?: CompositionOptions): FederationResult {
  // @TODO get router compatibility version programmatically
  return federateSubgraphs({
    options,
    subgraphs,
    version: ROUTER_COMPATIBILITY_VERSION_ONE,
  });
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
  if (config.disableUpdateCheck === 'true') {
    return;
  }

  try {
    mkdirSync(configDir, { recursive: true });

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

type PrintTruncationWarningParams = {
  displayedErrorCounts: SubgraphPublishStats;
  totalErrorCounts?: SubgraphPublishStats;
};

type KeyPressCallback = () => unknown | Promise<unknown>;

/**
 * Waits for a single keypress matching one of the keys in the provided map.
 * Keys are case-sensitive strings. Use 'Enter' for the enter key.
 * Each entry is either a callback function or a descriptor `{ callback, persistent }`.
 * When `persistent` is true the callback fires but the prompt keeps listening,
 * useful for side-effect actions (e.g. opening a URL) alongside a terminating key.
 */
export function waitForKeyPress(
  keyMap: Record<string, KeyPressCallback | { callback: KeyPressCallback; persistent: boolean } | undefined>,
  message?: string,
): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();

  if (message) {
    process.stdout.write(pc.dim(message));
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();

  const onData = async (data: Buffer) => {
    const key = data.toString();

    // Ctrl+C
    if (key === '\u0003') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      process.exit(0);
    }

    // Normalize Enter (\r or \n)
    const normalized = key === '\r' || key === '\n' ? 'Enter' : key;

    if (!(normalized in keyMap)) {
      return;
    }

    const entry = keyMap[normalized];
    if (!entry) {
      return;
    }

    const isDescriptor = typeof entry !== 'function';
    const callback = isDescriptor ? entry.callback : entry;
    const persistent = isDescriptor ? entry.persistent : false;

    if (persistent) {
      await callback();
      return;
    }

    process.stdin.removeListener('data', onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
    await callback();
    resolve();
  };

  process.stdin.on('data', onData);

  return promise;
}

export function printTruncationWarning({ displayedErrorCounts, totalErrorCounts }: PrintTruncationWarningParams) {
  if (!totalErrorCounts) {
    return;
  }

  const truncatedItems: string[] = [];

  if (totalErrorCounts.compositionErrors > displayedErrorCounts.compositionErrors) {
    truncatedItems.push(
      `composition errors (${displayedErrorCounts.compositionErrors} of ${totalErrorCounts.compositionErrors} shown)`,
    );
  }
  if (totalErrorCounts.compositionWarnings > displayedErrorCounts.compositionWarnings) {
    truncatedItems.push(
      `composition warnings (${displayedErrorCounts.compositionWarnings} of ${totalErrorCounts.compositionWarnings} shown)`,
    );
  }
  if (totalErrorCounts.deploymentErrors > displayedErrorCounts.deploymentErrors) {
    truncatedItems.push(
      `deployment errors (${displayedErrorCounts.deploymentErrors} of ${totalErrorCounts.deploymentErrors} shown)`,
    );
  }

  if (truncatedItems.length > 0) {
    console.log(pc.yellow(`\nNote: Some results were truncated: ${truncatedItems.join(', ')}.`));
  }
}

/**
 * Prints text with rainbow-like effect. Respects NO_COLOR
 */
export function rainbow(text: string): string {
  if (!pc.isColorSupported) {
    return text;
  }
  const chars = [...text];
  return (
    chars
      .map((char, i) => {
        const t = chars.length > 1 ? i / (chars.length - 1) : 0;
        const [r, g, b] = interpolateColor(t);
        return `\u001B[38;2;${r};${g};${b}m${char}`;
      })
      .join('') + '\u001B[0m'
  );
}

/** Strips ANSI SGR escape sequences (colors, bold, dim, etc.) from a string. */
export function stripAnsi(s: string): string {
  const ESC = String.fromCodePoint(0x1b);
  return s.replaceAll(new RegExp(`${ESC}\\[[\\d;]*m`, 'g'), '');
}

/** Returns the visible character count of a string, ignoring ANSI escape sequences. */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

// Gradient color stops: pink → orange → yellow → green → cyan → blue → purple
const gradientStops: [number, number, number][] = [
  [255, 100, 150], // pink
  [255, 160, 50], // orange
  [255, 220, 50], // yellow
  [80, 220, 100], // green
  [50, 200, 220], // cyan
  [80, 120, 255], // blue
  [180, 100, 255], // purple
];

function interpolateColor(t: number): [number, number, number] {
  const segment = t * (gradientStops.length - 1);
  const i = Math.min(Math.floor(segment), gradientStops.length - 2);
  const f = segment - i;
  return [
    Math.round(gradientStops[i][0] + (gradientStops[i + 1][0] - gradientStops[i][0]) * f),
    Math.round(gradientStops[i][1] + (gradientStops[i + 1][1] - gradientStops[i][1]) * f),
    Math.round(gradientStops[i][2] + (gradientStops[i + 1][2] - gradientStops[i][2]) * f),
  ];
}
