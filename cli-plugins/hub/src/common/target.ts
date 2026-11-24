import { existsSync } from 'node:fs';
import { failWith, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { configFileName, loadConfig } from '@wundergraph/wgc-plugin-sdk/config';
import type { LoadedConfig } from '@wundergraph/wgc-plugin-sdk/config';
import { locateProjectConfig } from './link.js';

const defaultAudience = 'hub';

export interface TargetOptions {
  config?: string;
  schema?: string;
  audience?: string;
}

export interface Target {
  schema: string;
  audience: string;
  /** Absent when `--schema` was given and there is no wundergraph.yaml. */
  config: LoadedConfig | undefined;
}

/** wundergraph.yaml from `--config` or the nearest parent directory; a missing file is a usage error. */
export const loadProjectConfig = (cwd: string, configFlag: string | undefined): Promise<Result<LoadedConfig>> => {
  const located = locateProjectConfig(cwd, configFlag);
  if (located === undefined) {
    return Promise.resolve(
      failWith({
        kind: 'usage',
        message: `${configFileName} not found in ${cwd} or any parent directory.`,
        remediation: 'Run `wgc hub init` to create one, or pass --config <path>.',
      }),
    );
  }
  return loadConfig(located);
};

/** The audience Hub expects: `--audience`, else HUB_OIDC_AUDIENCE, else `hub`. */
export const resolveAudience = (options: { audience?: string }, env: NodeJS.ProcessEnv): string =>
  options.audience || env.HUB_OIDC_AUDIENCE || defaultAudience;

/** Reads the graph from `--schema` or wundergraph.yaml; wundergraph.yaml is optional only with `--schema`. */
export const resolveTarget = async (
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: TargetOptions,
): Promise<Result<Target>> => {
  const audience = resolveAudience(options, env);
  const located = locateProjectConfig(cwd, options.config);
  if (options.schema && (located === undefined || !existsSync(located))) {
    return ok({ schema: options.schema, audience, config: undefined });
  }

  const loaded = await loadProjectConfig(cwd, options.config);
  if (!loaded.success) {
    if (options.schema) {
      return loaded;
    }
    return failWith({
      kind: 'usage',
      message: `No Hub schema given and ${loaded.errors[0].message}`,
      remediation: `Pass \`--schema <slug>\`, or run \`wgc hub init\` to create ${configFileName}.`,
    });
  }

  return ok({ schema: options.schema ?? loaded.data.config.graph, audience, config: loaded.data });
};
