import { existsSync } from 'node:fs';
import { failWith, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { locateSandboxConfig } from './link.js';
import { defaultAudience, loadSandboxConfig, sandboxFileName } from './sandbox-config.js';
import type { LoadedSandboxConfig } from './sandbox-config.js';

export interface TargetOptions {
  config?: string;
  schema?: string;
  audience?: string;
}

export interface Target {
  schema: string;
  audience: string;
  /** Absent when `--schema` was given and there is no sandbox.yaml. */
  config: LoadedSandboxConfig | undefined;
}

/** sandbox.yaml from `--config` or the nearest parent directory; a missing file is a usage error. */
export const loadProjectConfig = (
  cwd: string,
  configFlag: string | undefined,
): Promise<Result<LoadedSandboxConfig>> => {
  const located = locateSandboxConfig(cwd, configFlag);
  if (located === undefined) {
    return Promise.resolve(
      failWith({
        kind: 'usage',
        message: `${sandboxFileName} not found in ${cwd} or any parent directory.`,
        remediation: 'Run `wgc hub init` to create one, or pass --config <path>.',
      }),
    );
  }
  return loadSandboxConfig(located);
};

/** Reads the Hub schema slug from `--schema` or sandbox.yaml; sandbox.yaml is optional only with `--schema`. */
export const resolveTarget = async (cwd: string, options: TargetOptions): Promise<Result<Target>> => {
  const located = locateSandboxConfig(cwd, options.config);
  if (options.schema && (located === undefined || !existsSync(located))) {
    return ok({ schema: options.schema, audience: options.audience ?? defaultAudience, config: undefined });
  }

  const loaded = await loadProjectConfig(cwd, options.config);
  if (!loaded.success) {
    if (options.schema) {
      return loaded;
    }
    return failWith({
      kind: 'usage',
      message: `No Hub schema given and ${loaded.errors[0].message}`,
      remediation: 'Pass `--schema <slug>`, or run `wgc hub init` to create sandbox.yaml.',
    });
  }

  const { config } = loaded.data;
  return ok({
    schema: options.schema ?? config.schema,
    audience: options.audience ?? config.audience ?? defaultAudience,
    config: loaded.data,
  });
};

/** The audience Hub expects: `--audience`, else sandbox.yaml's, else the default. Never fails on a missing file. */
export const resolveAudience = async (cwd: string, options: TargetOptions): Promise<string> => {
  if (options.audience) {
    return options.audience;
  }
  const located = locateSandboxConfig(cwd, options.config);
  if (located === undefined) {
    return defaultAudience;
  }
  const loaded = await loadSandboxConfig(located);
  return loaded.success ? (loaded.data.config.audience ?? defaultAudience) : defaultAudience;
};
