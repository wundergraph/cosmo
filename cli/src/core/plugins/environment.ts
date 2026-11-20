import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { deployment } from '../deployment.js';

/** Where wgc looks for plugins. */
export interface PluginEnvironment {
  /** The wgc-managed npm project plugins are installed into. */
  managedDir: string;
  /** The cosmo repository root when wgc runs from a checkout; its `cli-plugins/<name>` packages win over installs. */
  workspaceRoot: string | undefined;
  /** True under tsx (`pnpm wgc`), where workspace plugins load from `src/index.ts` instead of their built `dist`. */
  runsFromSource: boolean;
  /** A base URL serving plugin tarballs as `<url>/wgc-plugin-<name>.tgz`, used by install instead of npm. A Hub deployment's wgc defaults to the Hub's. */
  registryUrl: string | undefined;
}

const findWorkspaceRoot = (start: string): string | undefined => {
  let directory = start;
  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml')) && existsSync(join(directory, 'cli-plugins'))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
};

export const defaultPluginEnvironment = (env: NodeJS.ProcessEnv = process.env): PluginEnvironment => ({
  managedDir: env.WGC_PLUGINS_DIR || join(homedir(), '.wgc', 'plugins'),
  workspaceRoot: findWorkspaceRoot(dirname(fileURLToPath(import.meta.url))),
  runsFromSource: import.meta.url.endsWith('.ts'),
  registryUrl: env.WGC_PLUGIN_REGISTRY_URL || (deployment.kind === 'hub' ? deployment.cliPackagesUrl : undefined),
});
