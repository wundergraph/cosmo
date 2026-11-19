import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'pathe';
import { errorMessage, failure, ok } from '@wundergraph/wgc-plugin-sdk';
import type { ProgressEvent, Result } from '@wundergraph/wgc-plugin-sdk';
import { PluginEnvironment } from './environment.js';
import { NpmRunner } from './npm.js';
import { isPluginPackage, knownPlugins, loadPlugin, packageEntry, readPackageJson } from './plugin-package.js';
import { readManifest, writeManifest } from './registry.js';

export interface InstalledPlugin {
  name: string;
  packageName: string;
  version: string;
  directory: string;
}

interface ManageOptions {
  environment: PluginEnvironment;
  npm: NpmRunner;
  progress: (event: ProgressEvent) => void;
}

const isLocalPath = (spec: string): boolean => spec.startsWith('file:') || spec.startsWith('.') || isAbsolute(spec);

/** `@scope/name@1.2.3` → `@scope/name`, `name@latest` → `name`. */
const registryPackageName = (spec: string): string => {
  const versionAt = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return versionAt === -1 ? spec : spec.slice(0, versionAt);
};

/** What to hand npm and which package name it will install. */
const resolveInstallTarget = (spec: string): Result<{ npmSpec: string; packageName: string }> => {
  const known = knownPlugins[spec];
  if (known) {
    return ok({ npmSpec: known, packageName: known });
  }
  if (!isLocalPath(spec)) {
    return ok({ npmSpec: spec, packageName: registryPackageName(spec) });
  }
  const directory = resolve(process.cwd(), spec.replace(/^file:/, ''));
  const pkg = readPackageJson(directory);
  if (!pkg.success) {
    return pkg;
  }
  return ok({ npmSpec: directory, packageName: pkg.data.name });
};

const ensureManagedProject = (managedDir: string): void => {
  mkdirSync(managedDir, { recursive: true });
  const packageJsonPath = join(managedDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    const project = { name: 'wgc-plugins', private: true, description: 'Plugins installed by wgc plugins install' };
    writeFileSync(packageJsonPath, `${JSON.stringify(project, null, 2)}\n`);
  }
};

const verifyInstalledPlugin = async (
  environment: PluginEnvironment,
  packageName: string,
  reservedNames: string[],
): Promise<Result<InstalledPlugin>> => {
  const directory = join(environment.managedDir, 'node_modules', packageName);
  const pkg = readPackageJson(directory);
  if (!pkg.success) {
    return pkg;
  }
  if (!isPluginPackage(pkg.data)) {
    return failure(
      `${packageName} is not a wgc plugin. Plugin packages are named wgc-plugin-<name> or list "wgc-plugin" in their keywords.`,
    );
  }

  const plugin = await loadPlugin(packageEntry(directory, pkg.data));
  if (!plugin.success) {
    return plugin;
  }
  if (reservedNames.includes(plugin.data.name)) {
    return failure(`${packageName} wants the ${plugin.data.name} command, which is built into wgc.`);
  }
  const owner = readManifest(environment).plugins[plugin.data.name];
  if (owner && owner !== packageName) {
    return failure(`The ${plugin.data.name} command already comes from ${owner}. Remove it first.`);
  }
  return ok({ name: plugin.data.name, packageName, version: pkg.data.version, directory });
};

export const installPlugin = async ({
  environment,
  npm,
  progress,
  spec,
  reservedNames,
}: ManageOptions & { spec: string; reservedNames: string[] }): Promise<Result<InstalledPlugin>> => {
  const target = resolveInstallTarget(spec);
  if (!target.success) {
    return target;
  }
  const { npmSpec, packageName } = target.data;

  progress({ step: 'prepare', subject: environment.managedDir, message: 'Preparing the plugin directory' });
  ensureManagedProject(environment.managedDir);

  progress({ step: 'npm-install', subject: packageName, message: `Installing ${npmSpec} with npm` });
  const installed = await npm(['install', '--save', '--no-audit', '--no-fund', npmSpec], environment.managedDir);
  if (!installed.success) {
    return installed;
  }

  progress({ step: 'verify', subject: packageName, message: 'Checking the package is a wgc plugin' });
  const verified = await verifyInstalledPlugin(environment, packageName, reservedNames);
  if (!verified.success) {
    progress({ step: 'rollback', subject: packageName, message: 'Uninstalling the package again' });
    const uninstalled = await npm(
      ['uninstall', '--save', '--no-audit', '--no-fund', packageName],
      environment.managedDir,
    );
    if (!uninstalled.success) {
      return failure(`${errorMessage(verified)} Uninstalling it failed too: ${errorMessage(uninstalled)}`);
    }
    return verified;
  }

  const manifest = readManifest(environment);
  writeManifest(environment, { plugins: { ...manifest.plugins, [verified.data.name]: packageName } });
  return verified;
};

export const removePlugin = async ({
  environment,
  npm,
  progress,
  name,
}: ManageOptions & { name: string }): Promise<Result<{ name: string; packageName: string }>> => {
  const { plugins } = readManifest(environment);
  const entry = Object.entries(plugins).find(([command, packageName]) => command === name || packageName === name);
  if (!entry) {
    return failure(`No plugin named ${name} is installed in ${environment.managedDir}.`);
  }
  const [command, packageName] = entry;

  progress({ step: 'npm-uninstall', subject: packageName, message: `Uninstalling ${packageName} with npm` });
  const uninstalled = await npm(
    ['uninstall', '--save', '--no-audit', '--no-fund', packageName],
    environment.managedDir,
  );
  if (!uninstalled.success) {
    return uninstalled;
  }

  const remaining = Object.fromEntries(Object.entries(plugins).filter(([key]) => key !== command));
  writeManifest(environment, { plugins: remaining });
  return ok({ name: command, packageName });
};
