import { existsSync } from 'node:fs';
import path from 'node:path';
import { ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { actionable } from './failure.js';
import { defaultAudience, loadSandboxConfig, SandboxConfig } from './sandbox-config.js';

export interface TargetOptions {
  config: string;
  schema?: string;
  audience?: string;
}

export interface Target {
  schema: string;
  audience: string;
  /** Absent when `--schema` was given and there is no sandbox.yaml. */
  config: SandboxConfig | undefined;
}

/** Reads the Hub schema slug from `--schema` or sandbox.yaml; sandbox.yaml is optional only with `--schema`. */
export const resolveTarget = async (options: TargetOptions): Promise<Result<Target>> => {
  if (options.schema && !existsSync(path.resolve(options.config))) {
    return ok({ schema: options.schema, audience: options.audience ?? defaultAudience, config: undefined });
  }

  const loaded = await loadSandboxConfig(options.config);
  if (!loaded.success) {
    if (!options.schema) {
      return actionable(
        `No Hub schema given and ${loaded.errors[0].message}`,
        'Pass `--schema <slug>`, or run `wgc hub init` to create sandbox.yaml.',
        options.config,
      );
    }
    return loaded;
  }

  const { config } = loaded.data;
  return ok({
    schema: options.schema ?? config.schema,
    audience: options.audience ?? config.audience ?? defaultAudience,
    config,
  });
};
