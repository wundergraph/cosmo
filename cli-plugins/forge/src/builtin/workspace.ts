import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import {
  configFileName,
  lockFileName,
  parseConfig,
  parseLock,
  renderConfig,
  renderLock,
} from '@wundergraph/wgc-plugin-sdk/config';
import type { Lock, RouterConfig, WundergraphConfig } from '@wundergraph/wgc-plugin-sdk/config';

/** Where Forge keeps generated files inside a workspace. Everything under `.forge` can be deleted. */
export const workspacePaths = (workspace: string, router: RouterConfig) => ({
  buildDirectory: path.join(workspace, '.forge', 'build'),
  binary: path.resolve(workspace, router.binary),
  candidateBuildDirectory: path.join(workspace, '.forge', 'candidate', 'build'),
  candidateBinary: path.join(workspace, '.forge', 'candidate', 'router'),
});

export const modulesDirectory = 'modules';

export const readConfig = async (workspace: string): Promise<Result<WundergraphConfig>> => {
  let text: string;
  try {
    text = await readFile(path.join(workspace, configFileName), 'utf8');
  } catch {
    return failWith({
      message: `No ${configFileName} in ${workspace}.`,
      input: path.join(workspace, configFileName),
      remediation: `Run \`wgc forge init\` to add a router to ${configFileName} here, or pass --dir <directory of ${configFileName}>.`,
    });
  }
  return parseConfig(text, configFileName);
};

export interface RouterWorkspace {
  config: WundergraphConfig;
  router: RouterConfig;
}

/** Reads wundergraph.yaml, which must have a `router` section for every command that builds the router. */
export const readRouterWorkspace = async (workspace: string): Promise<Result<RouterWorkspace>> => {
  const config = await readConfig(workspace);
  if (!config.success) {
    return config;
  }
  if (config.data.router === undefined) {
    return failWith({
      message: `${configFileName} in ${workspace} has no \`router\` section.`,
      input: `${configFileName}: router`,
      remediation: 'Run `wgc forge init` to select a router release.',
    });
  }
  return { success: true, data: { config: config.data, router: config.data.router } };
};

/** Renders the whole config, so every section Forge does not change is written back as it was read. */
export const writeConfig = async (workspace: string, config: WundergraphConfig): Promise<void> => {
  await writeFile(path.join(workspace, configFileName), renderConfig(config));
};

/** Reads wundergraph.lock. A workspace that has never been locked has none, which is not an error. */
export const readLock = async (workspace: string): Promise<Result<Lock | undefined>> => {
  let text: string;
  try {
    text = await readFile(path.join(workspace, lockFileName), 'utf8');
  } catch {
    return { success: true, data: undefined };
  }
  const parsed = parseLock(text, lockFileName);
  if (!parsed.success) {
    return failWith({
      message: parsed.errors.map((error) => error.message).join('\n'),
      input: lockFileName,
      remediation: `Delete ${lockFileName} and run \`wgc forge lock\` to write it again.`,
    });
  }
  return parsed;
};

export const writeLock = async (workspace: string, lock: Lock): Promise<void> => {
  await writeFile(path.join(workspace, lockFileName), renderLock(lock));
};
