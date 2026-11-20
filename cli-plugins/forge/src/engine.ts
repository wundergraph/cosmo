import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import type { PluginContext } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';

/** What runs `wgc forge`: the Forge CLI itself, or the commands built into this plugin until Forge ships. */
export interface ForgeEngine {
  register(command: Command, context: PluginContext): void;
}

export type EngineChoice = { kind: 'binary'; binary: string } | { kind: 'builtin' };

/** Set to a path to run that Forge binary, or to `builtin` to ignore any `forge` on PATH. */
export const binaryVariable = 'WGC_FORGE_BINARY';

const isExecutableFile = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const findOnPath = (name: string, searchPath: string): string | undefined => {
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === '') {
      continue;
    }

    const candidate = path.join(directory, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

export const chooseEngine = (env: NodeJS.ProcessEnv): EngineChoice => {
  const override = env[binaryVariable];
  if (override === 'builtin') {
    return { kind: 'builtin' };
  }
  if (override) {
    return { kind: 'binary', binary: override };
  }

  const found = findOnPath('forge', env.PATH ?? '');
  if (found === undefined) {
    return { kind: 'builtin' };
  }

  return { kind: 'binary', binary: found };
};
