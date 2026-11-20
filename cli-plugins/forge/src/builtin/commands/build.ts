import type { Command } from 'commander';
import { buildRouter } from '../build.js';
import { toFailure } from '../failure.js';
import { lockFileName, readLock } from '../lock.js';
import { manifestFileName, readManifest } from '../manifest.js';
import { lockMatches } from '../pins.js';
import { workspacePaths } from '../workspace.js';
import { moduleSummaries, routerSummary, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface BuildOptions extends CommonOptions {
  routerReplace?: string;
}

export const registerBuild = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('build')
      .description('Build the router with the workspace modules. A failed build keeps the previous binary.')
      .option(
        '--router-replace <directory>',
        'Build from a local checkout of the router module instead of the pinned version. For router development.',
      ),
  ).action(async (options: BuildOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const manifest = await readManifest(workspace);
    if (!manifest.success) {
      return output.fail(toFailure(manifest));
    }
    const lock = await readLock(workspace);
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    if (!lockMatches(manifest.data, lock.data)) {
      return output.fail({
        message: `${lockFileName} does not pin what ${manifestFileName} asks for, and a build never changes pins.`,
        input: lockFileName,
        fix: 'Run `wgc forge lock` to review and pin the changes, then build again.',
      });
    }

    const paths = workspacePaths(workspace, manifest.data);
    const built = await buildRouter({
      workspace,
      manifest: manifest.data,
      lock: lock.data,
      buildDirectory: paths.buildDirectory,
      binaryPath: paths.binary,
      routerReplace: options.routerReplace,
      system,
      output,
    });
    if (!built.success) {
      return output.fail(toFailure(built));
    }

    const localModules = manifest.data.modules.length - lock.data.modules.length;
    output.result(
      {
        binary: built.data.binary,
        router: routerSummary(lock.data),
        modules: moduleSummaries(lock.data),
        localModules,
      },
      (data) =>
        `Built ${data.binary}\n  router ${data.router.source} (${data.router.version}), ${manifest.data.modules.length} module(s)`,
    );
  });
};
