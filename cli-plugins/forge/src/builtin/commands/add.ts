import { stat } from 'node:fs/promises';
import path from 'node:path';
import { failWith, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { readLocalModuleName } from '../build.js';
import { readLock, writeLock } from '../lock.js';
import type { LockedModule } from '../lock.js';
import { describeModuleSource, isLocalModule, readManifest, sameSource, writeManifest } from '../manifest.js';
import type { ModuleSource } from '../manifest.js';
import { describePinChange, diffPins, resolvePins, sameModule } from '../pins.js';
import { askToAccept, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface AddOptions extends CommonOptions {
  ref?: string;
  package?: string;
  yes?: boolean;
}

const isDirectory = async (target: string): Promise<boolean> => {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
};

const isGitUrl = (source: string): boolean =>
  /^[+a-z]+:\/\//.test(source) || source.startsWith('git@') || source.endsWith('.git');

/** Reads what was typed after `add` as a Git URL, a local directory or a Go package. */
const classifySource = async (
  workspace: string,
  invokedFrom: string,
  source: string,
  options: AddOptions,
): Promise<Result<ModuleSource>> => {
  if (isGitUrl(source)) {
    return {
      success: true,
      data: {
        git: source,
        ...(options.ref === undefined ? {} : { ref: options.ref }),
        ...(options.package === undefined ? {} : { package: options.package }),
      },
    };
  }

  if (options.ref !== undefined || options.package !== undefined) {
    return failWith({
      message: '--ref and --package only apply to a Git URL.',
      input: source,
      remediation: 'For a Go package, put the version after an @, for example github.com/acme/mod/headers@v1.2.0.',
    });
  }

  const directory = path.resolve(invokedFrom, source);
  if (source.startsWith('.') || path.isAbsolute(source) || (await isDirectory(directory))) {
    const relative = path.relative(workspace, directory).split(path.sep).join('/');
    const modulePath = relative.startsWith('..') ? directory : `./${relative}`;
    const name = await readLocalModuleName(workspace, modulePath);
    if (!name.success) {
      return name;
    }
    return { success: true, data: { path: modulePath } };
  }

  const [packagePath, version] = source.split('@');
  return { success: true, data: { go: packagePath, ...(version ? { version } : {}) } };
};

const pinSummary = (pinned: LockedModule | undefined) =>
  pinned === undefined
    ? {}
    : { pinned: { module: pinned.module, package: pinned.package, version: pinned.version, commit: pinned.commit } };

export const registerAdd = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('add')
      .description(
        'Register a local path, Go package path or Git URL. Re-adding a registered module previews its newer selection.',
      )
      .argument('<source>', 'A directory, a Go package path (optionally @version) or a Git URL.')
      .option('--ref <ref>', 'The branch, tag or commit of a Git URL. Defaults to the default branch.')
      .option('--package <directory>', 'The directory of the Go package inside a Git repository.')
      .option('--yes', 'Accept the new selection of a re-added module without asking.'),
  ).action(async (source: string, options: AddOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const manifest = await readManifest(workspace);
    if (!manifest.success) {
      return output.fail(toFailure(manifest));
    }
    const previous = await readLock(workspace);
    if (!previous.success) {
      return output.fail(toFailure(previous));
    }

    const module = await classifySource(workspace, dependencies.cwd(), source, options);
    if (!module.success) {
      return output.fail(toFailure(module));
    }

    const registered = manifest.data.modules.find((existing) => sameModule(existing, module.data));
    const modules =
      registered === undefined
        ? [...manifest.data.modules, module.data]
        : manifest.data.modules.map((existing) => (existing === registered ? module.data : existing));
    const updated = { ...manifest.data, modules };

    // Dropping the old pin makes a re-added branch or versionless package resolve again.
    const keptPins =
      previous.data === undefined || registered === undefined
        ? previous.data
        : {
            ...previous.data,
            modules: previous.data.modules.filter((locked) => !sameModule(locked.source, registered)),
          };
    const lock = await resolvePins({ manifest: updated, previous: keptPins, system, output });
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }

    const pinned = lock.data.modules.find((locked) => sameSource(locked.source, module.data));
    const result = { added: module.data, ...pinSummary(pinned) };

    if (registered === undefined) {
      await writeManifest(workspace, updated);
      await writeLock(workspace, lock.data);
      return output.result(result, () =>
        isLocalModule(module.data)
          ? `Added local module ${describeModuleSource(module.data)}. It is built from disk and not pinned.`
          : `Added ${describeModuleSource(module.data)} pinned at ${pinned?.version}.`,
      );
    }

    const changes = diffPins(previous.data?.modules ?? [], lock.data.modules);
    if (changes.length === 0 && sameSource(registered, module.data)) {
      return output.result({ ...result, changes, written: false }, () =>
        isLocalModule(module.data)
          ? `${describeModuleSource(module.data)} is already registered.`
          : `${describeModuleSource(module.data)} is already registered at ${pinned?.version}.`,
      );
    }

    const preview =
      changes.length === 0
        ? `~ ${describeModuleSource(module.data)}`
        : changes.map((change) => describePinChange(change)).join('\n');
    const acceptance = await askToAccept(context, options, `${preview}\nAccept the new selection?`);

    if (acceptance === 'needs-yes') {
      return output.fail({
        kind: 'confirmation',
        message: `${describeModuleSource(module.data)} is already registered. Re-adding it changes its selection. Nothing was written.\n${preview}`,
        input: source,
        remediation: `Review the change, then run the command again with --yes to accept it.`,
        data: { ...result, changes, written: false },
      });
    }

    if (acceptance === 'declined') {
      return output.result({ ...result, changes, written: false }, () => 'Kept the current selection.');
    }

    await writeManifest(workspace, updated);
    await writeLock(workspace, lock.data);
    output.result(
      { ...result, changes, written: true },
      () => `Updated ${describeModuleSource(module.data)}\n${preview}`,
    );
  });
};
