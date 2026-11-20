import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
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

interface InstallTarget {
  /** Everything handed to one `npm install`. */
  npmSpecs: string[];
  /** The spec of the plugin itself among `npmSpecs`. */
  pluginSpec: string;
  /** Undefined when only the downloaded tarball names the package. */
  packageName: string | undefined;
}

const pluginNamePattern = /^[a-z][\da-z-]*$/;

/**
 * A plugin tarball from the registry URL, installed together with the SDK tarball next to it, so the
 * plugin's SDK dependency resolves from the same server instead of npm.
 */
const registryTarget = (registryUrl: string, name: string): InstallTarget => {
  const base = registryUrl.replace(/\/+$/, '');
  const pluginSpec = `${base}/wgc-plugin-${name}.tgz`;
  return { npmSpecs: [`${base}/wgc-plugin-sdk.tgz`, pluginSpec], pluginSpec, packageName: knownPlugins[name] };
};

/** npm 12 refuses remote tarballs unless asked; the registry URL is the user's explicit choice. */
const remoteFlags = (environment: PluginEnvironment): string[] =>
  environment.registryUrl === undefined ? [] : ['--allow-remote=all'];

const npmTarget = (spec: string): Result<InstallTarget> => {
  const known = knownPlugins[spec];
  if (known) {
    return ok({ npmSpecs: [known], pluginSpec: known, packageName: known });
  }

  if (!isLocalPath(spec)) {
    const packageName = registryPackageName(spec);
    return ok({ npmSpecs: [spec], pluginSpec: spec, packageName });
  }

  const directory = resolve(process.cwd(), spec.replace(/^file:/, ''));
  const pkg = readPackageJson(directory);
  if (!pkg.success) {
    return pkg;
  }
  return ok({ npmSpecs: [directory], pluginSpec: directory, packageName: pkg.data.name });
};

const resolveInstallTarget = (spec: string, registryUrl: string | undefined): Result<InstallTarget> => {
  if (registryUrl !== undefined && pluginNamePattern.test(spec)) {
    return ok(registryTarget(registryUrl, spec));
  }
  return npmTarget(spec);
};

/** The package npm saved for `pluginSpec` in the managed project, e.g. the name inside a downloaded tarball. */
const savedPackageName = (managedDir: string, pluginSpec: string): Result<string> => {
  const packageJsonPath = join(managedDir, 'package.json');
  const dependencies = z
    .object({ dependencies: z.record(z.string(), z.string()).default({}) })
    .parse(JSON.parse(readFileSync(packageJsonPath, 'utf8'))).dependencies;

  const saved = Object.entries(dependencies).find(([, savedSpec]) => savedSpec === pluginSpec);
  if (!saved) {
    return failure(`npm installed ${pluginSpec}, but ${packageJsonPath} does not list it.`);
  }
  return ok(saved[0]);
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
  const target = resolveInstallTarget(spec, environment.registryUrl);
  if (!target.success) {
    return target;
  }
  const { npmSpecs, pluginSpec } = target.data;

  progress({ step: 'prepare', subject: environment.managedDir, message: 'Preparing the plugin directory' });
  ensureManagedProject(environment.managedDir);

  progress({ step: 'npm-install', subject: pluginSpec, message: `Installing ${npmSpecs.join(' ')} with npm` });
  const installed = await npm(
    ['install', '--save', '--no-audit', '--no-fund', ...remoteFlags(environment), ...npmSpecs],
    environment.managedDir,
  );
  if (!installed.success) {
    return installed;
  }

  let packageName = target.data.packageName;
  if (packageName === undefined) {
    const saved = savedPackageName(environment.managedDir, pluginSpec);
    if (!saved.success) {
      return saved;
    }
    packageName = saved.data;
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
