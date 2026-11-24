import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Warning } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import jwtDecode from 'jwt-decode';
import pc from 'picocolors';
import { dirname, join } from 'pathe';
import { config, getBaseHeaders } from '../../core/config.js';
import { GraphToken } from '../auth/utils.js';
import { makeSignature, safeCompare } from '../../core/signature.js';
import type { FetchRouterConfigResult } from './types/types.js';
import type { FetchRouterConfigParams } from './types/params.js';

export const featureFlagsDir = 'feature-flags';
export const latestFile = 'latest.json';
export const mapperFile = 'mapper.json';
export const routerConfigFile = 'router-config.json';

const invalidCharacters = /[./]/;

export async function getRouterConfigOutputFile(out: string): Promise<string> {
  let output: string = out;

  /**
   * If the provided output doesn't end with `.json`, assume it's a directory and append the filename; otherwise,
   * if the directory doesn't exist, we need to create before writing the file
   */
  if (output.toLowerCase().endsWith('.json')) {
    const dir = dirname(output);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  } else {
    if (!existsSync(output)) {
      await mkdir(output, { recursive: true });
    }

    output = join(out, routerConfigFile);
  }

  return output;
}

export const fetchRouterConfig = async ({
  client,
  name,
  namespace,
  graphSignKey,
}: FetchRouterConfigParams): Promise<FetchRouterConfigResult> => {
  const resp = await client.platform.generateRouterToken(
    {
      fedGraphName: name,
      namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    throw new Error(
      `${pc.red(`Could not fetch the router config for the graph ${pc.bold(name)}`)} \n${pc.red(
        pc.bold(resp.response?.details || ''),
      )}`,
    );
  }

  // Try to decode the generated token
  let decoded: GraphToken;
  try {
    decoded = jwtDecode<GraphToken>(resp.token);
  } catch {
    throw new Error(pc.red('Could not fetch the router config. Please try again'));
  }

  const baseUrl = new URL(`/${decoded.organization_id}/${decoded.federated_graph_id}/`, config.cdnURL);
  if (!decoded.features?.includes('split-config-loading')) {
    // Legacy router config fetching
    return {
      splitConfigLoading: false,
      routerConfig: await fetchFileContentFromCdn(
        new URL('routerconfigs/latest.json', baseUrl),
        resp.token,
        graphSignKey,
      ),
    };
  }

  // Retrieve the latest router configuration
  const result: FetchRouterConfigResult = {
    splitConfigLoading: true,
    routerConfig: await fetchFileContentFromCdn(new URL('manifest/latest.json', baseUrl), resp.token, graphSignKey),
  };

  // Retrieve the `mapper.json` file and convert the content to a `Map<string, string>` for validation
  const mapperTextContent = await fetchFileContentFromCdn(new URL('manifest/mapper.json', baseUrl), resp.token);

  const mapperRecord = JSON.parse(mapperTextContent);
  const mapper =
    typeof mapperRecord === 'object' && !Array.isArray(mapperRecord)
      ? new Map<string, string>(Object.entries(mapperRecord))
      : new Map<string, string>();

  result.mapper = Object.fromEntries(mapper);
  mapper.delete(''); // Delete the federated graph hash

  if (mapper.size === 0) {
    return result;
  }

  // Fetch the latest router configuration for each feature flag
  result.featureFlags = new Map<string, string>();
  for (const [featureFlagName] of mapper) {
    result.featureFlags.set(
      featureFlagName,
      await fetchFileContentFromCdn(
        new URL(`manifest/feature-flags/${featureFlagName}.json`, baseUrl),
        resp.token,
        graphSignKey,
      ),
    );
  }

  return result;
};

export async function writeFeatureFlagConfigToFile(
  basePath: string,
  featureFlagName: string,
  featureFlagConfig: string,
) {
  if (invalidCharacters.test(featureFlagName)) {
    throw new Error(`The feature flag name "${featureFlagName}" contains invalid characters.`);
  }

  await writeFile(join(basePath, `${featureFlagName}.json`), featureFlagConfig);
}

async function fetchFileContentFromCdn(url: URL, token: string, graphSignKey?: string): Promise<string> {
  const headers = new Headers();
  headers.append('Content-Type', 'application/json; charset=UTF-8');
  headers.append('Authorization', 'Bearer ' + token);
  headers.append('Accept-Encoding', 'gzip');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Version: '' }),
  });

  if (!response.ok) {
    // The fetch failed the file from CDN
    throw new Error(pc.red(`Failed to fetch file "${url}": ${response.status} ${response.statusText}`));
  }

  const body = await response.text();
  if (!graphSignKey) {
    // No signature key was provided, we don't need to validate the signature header
    return body;
  }

  // Ensure that we got a signature header and that signing the body using the provided signature key matches
  // the header value
  const signature = response.headers.get('X-Signature-SHA256');
  if (!signature) {
    throw new Error(pc.red('You provided a signature key, but the router config does not have a signature header.'));
  }

  const hash = await makeSignature(body, graphSignKey);
  if (!safeCompare(hash, signature)) {
    throw new Error(pc.red('The signature of the router config does not match the provided signature key.'));
  }

  return body;
}

/**
 * The router config is printed to stdout only if no destination is provided. Split configs are always written
 * to a directory.
 */
export function isRouterConfigPrintedToStdout(options: { out?: string; splitConfigsEnabled?: boolean }): boolean {
  return !options.out && !options.splitConfigsEnabled;
}

type CompositionDiagnosticsParams = {
  warnings: Array<Warning>;
  json?: boolean;
  // Diagnostics must not be mixed into stdout when the router config is printed there.
  toStderr: boolean;
  // Set when the diagnostics were produced while composing a feature flag rather than the base graph.
  featureFlagName?: string;
};

function toCompositionDiagnosticsJSON(errors: Array<Error>, warnings: Array<Warning>, featureFlagName?: string) {
  return JSON.stringify({
    ...(featureFlagName ? { featureFlag: featureFlagName } : {}),
    errors: errors.map((error) => ({ message: error.message })),
    warnings: warnings.map((warning) => ({ message: warning.message, subgraphName: warning.subgraph?.name })),
  });
}

function toMessagesTable(head: string, messages: Array<string>): string {
  const table = new Table({
    head: [pc.bold(pc.white(head))],
    colWidths: [120],
    wordWrap: true,
  });
  for (const message of messages) {
    table.push([message]);
  }
  return table.toString();
}

/**
 * Prints the composition errors either as a table or, if the json option is set, as a single JSON document.
 * Rendering a table is very slow for huge error messages, which the JSON output avoids.
 *
 * The output is written to stderr if the router config is printed to stdout, and to stdout otherwise.
 */
export function printCompositionErrors({
  errors,
  warnings,
  json,
  toStderr,
  featureFlagName,
}: CompositionDiagnosticsParams & { errors: Array<Error> }) {
  const print = toStderr ? console.error : console.log;
  if (json) {
    print(toCompositionDiagnosticsJSON(errors, warnings, featureFlagName));
    return;
  }

  const target = featureFlagName ? ` the feature flag ${pc.italic(featureFlagName)}` : '';
  print(pc.red(`We found composition errors, while composing${target}.\n${pc.bold('Please check the errors below:')}`));
  print(
    toMessagesTable(
      'ERROR_MESSAGE',
      errors.map((error) => error.message),
    ),
  );
}

/**
 * Prints the composition warnings of a successful composition either as a table or, if the json option is set,
 * as a single JSON document. The output is written to stderr if the router config is printed to stdout, and to
 * stdout otherwise.
 */
export function printCompositionWarnings({ warnings, json, toStderr, featureFlagName }: CompositionDiagnosticsParams) {
  if (warnings.length === 0) {
    return;
  }

  const print = toStderr ? console.error : console.log;
  if (json) {
    print(toCompositionDiagnosticsJSON([], warnings, featureFlagName));
    return;
  }

  const target = featureFlagName ? ` the feature flag ${pc.italic(featureFlagName)}` : '';
  print(pc.yellow(`The following warnings were produced while composing${target}:`));
  print(
    toMessagesTable(
      'WARNING_MESSAGE',
      warnings.map((warning) => warning.message),
    ),
  );
}
