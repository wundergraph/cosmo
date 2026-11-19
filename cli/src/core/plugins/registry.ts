import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { z } from 'zod';
import { PluginEnvironment } from './environment.js';
import { isPluginPackage, knownPlugins, packageEntry, readPackageJson } from './plugin-package.js';

export type PluginSource = 'workspace' | 'installed';

export interface ResolvedPlugin {
  /** The top-level command, e.g. `hub`. */
  name: string;
  packageName: string;
  version: string;
  source: PluginSource;
  entryPath: string;
}

/** `plugins.json` in the managed directory maps each installed command name to the npm package providing it. */
const manifestSchema = z.object({ plugins: z.record(z.string(), z.string()) });

export type Manifest = z.infer<typeof manifestSchema>;

const manifestPath = (environment: PluginEnvironment) => join(environment.managedDir, 'plugins.json');

export const readManifest = (environment: PluginEnvironment): Manifest => {
  const path = manifestPath(environment);
  if (!existsSync(path)) {
    return { plugins: {} };
  }
  try {
    return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { plugins: {} };
  }
};

export const writeManifest = (environment: PluginEnvironment, manifest: Manifest): void => {
  writeFileSync(manifestPath(environment), `${JSON.stringify(manifest, null, 2)}\n`);
};

const readWorkspacePlugin = (environment: PluginEnvironment, name: string): ResolvedPlugin | undefined => {
  if (!environment.workspaceRoot) {
    return undefined;
  }
  const directory = join(environment.workspaceRoot, 'cli-plugins', name);
  const pkg = readPackageJson(directory);
  if (!pkg.success || !isPluginPackage(pkg.data)) {
    return undefined;
  }
  return {
    name,
    packageName: pkg.data.name,
    version: pkg.data.version,
    source: 'workspace',
    entryPath: environment.runsFromSource ? join(directory, 'src', 'index.ts') : packageEntry(directory, pkg.data),
  };
};

const readInstalledPlugin = (
  environment: PluginEnvironment,
  name: string,
  packageName: string,
): ResolvedPlugin | undefined => {
  const directory = join(environment.managedDir, 'node_modules', packageName);
  const pkg = readPackageJson(directory);
  if (!pkg.success) {
    return undefined;
  }
  return {
    name,
    packageName,
    version: pkg.data.version,
    source: 'installed',
    entryPath: packageEntry(directory, pkg.data),
  };
};

export const listWorkspacePlugins = (environment: PluginEnvironment): ResolvedPlugin[] => {
  if (!environment.workspaceRoot) {
    return [];
  }
  const pluginsRoot = join(environment.workspaceRoot, 'cli-plugins');
  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readWorkspacePlugin(environment, entry.name))
    .filter((plugin) => plugin !== undefined);
};

export const listInstalledPlugins = (environment: PluginEnvironment): ResolvedPlugin[] =>
  Object.entries(readManifest(environment).plugins)
    .map(([name, packageName]) => readInstalledPlugin(environment, name, packageName))
    .filter((plugin) => plugin !== undefined);

/** The plugin providing command `name`: the workspace package first, then the managed install. */
export const resolvePlugin = (environment: PluginEnvironment, name: string): ResolvedPlugin | undefined => {
  const workspace = readWorkspacePlugin(environment, name);
  if (workspace) {
    return workspace;
  }
  const packageName = readManifest(environment).plugins[name];
  return packageName ? readInstalledPlugin(environment, name, packageName) : undefined;
};

export interface PluginListing {
  name: string;
  packageName: string;
  /** Undefined for a known plugin that is not installed. */
  version: string | undefined;
  source: PluginSource | 'available';
  /** Whether `wgc <name>` runs this entry; a workspace package shadows an install of the same name. */
  active: boolean;
}

export const listPlugins = (environment: PluginEnvironment): PluginListing[] => {
  const resolved = [...listWorkspacePlugins(environment), ...listInstalledPlugins(environment)];
  const resolvedNames = new Set(resolved.map((plugin) => plugin.name));

  const listings: PluginListing[] = resolved.map((plugin) => ({
    name: plugin.name,
    packageName: plugin.packageName,
    version: plugin.version,
    source: plugin.source,
    active: resolvePlugin(environment, plugin.name)?.source === plugin.source,
  }));

  for (const [name, packageName] of Object.entries(knownPlugins)) {
    if (!resolvedNames.has(name)) {
      listings.push({ name, packageName, version: undefined, source: 'available', active: false });
    }
  }
  return listings;
};
