import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { readLocalModuleName } from '../build.js';
import { fail, toFailure } from '../failure.js';
import { readLock, writeLock } from '../lock.js';
import { describeModuleSource, isLocalModule, readManifest, sameSource, writeManifest } from '../manifest.js';
import type { ModuleSource } from '../manifest.js';
import { resolvePins } from '../pins.js';
import { withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface AddOptions extends CommonOptions {
  ref?: string;
  package?: string;
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
    return fail({
      message: '--ref and --package only apply to a Git URL.',
      input: source,
      fix: 'For a Go package, put the version after an @, for example github.com/acme/mod/headers@v1.2.0.',
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

export const registerAdd = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('add')
      .description('Add a module to the workspace: a local directory, a Go package or a Git URL.')
      .argument('<source>', 'A directory, a Go package path (optionally @version) or a Git URL.')
      .option('--ref <ref>', 'The branch, tag or commit of a Git URL. Defaults to the default branch.')
      .option('--package <directory>', 'The directory of the Go package inside a Git repository.'),
  ).action(async (source: string, options: AddOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const manifest = await readManifest(workspace);
    if (!manifest.success) {
      return output.fail(toFailure(manifest));
    }

    const module = await classifySource(workspace, dependencies.cwd(), source, options);
    if (!module.success) {
      return output.fail(toFailure(module));
    }
    if (manifest.data.modules.some((existing) => sameSource(existing, module.data))) {
      return output.fail({
        message: `${describeModuleSource(module.data)} is already a module of this workspace.`,
        input: source,
        fix: 'Nothing to do. Run `wgc forge lock` to move its pin forward.',
      });
    }

    const previous = await readLock(workspace);
    if (!previous.success) {
      return output.fail(toFailure(previous));
    }
    const updated = { ...manifest.data, modules: [...manifest.data.modules, module.data] };
    const lock = await resolvePins({ manifest: updated, previous: previous.data, refresh: false, system, output });
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }

    await writeManifest(workspace, updated);
    await writeLock(workspace, lock.data);

    const pinned = lock.data.modules.find((locked) => sameSource(locked.source, module.data));
    output.result(
      {
        added: module.data,
        ...(pinned === undefined
          ? {}
          : {
              pinned: {
                module: pinned.module,
                package: pinned.package,
                version: pinned.version,
                commit: pinned.commit,
              },
            }),
      },
      (data) =>
        isLocalModule(data.added)
          ? `Added local module ${data.added.path}. It is built from disk and not pinned.`
          : `Added ${describeModuleSource(data.added)} pinned at ${data.pinned?.version}.`,
    );
  });
};
