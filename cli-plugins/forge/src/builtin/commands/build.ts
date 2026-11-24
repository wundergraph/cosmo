import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { configFileName, lockFileName } from '@wundergraph/wgc-plugin-sdk/config';
import { buildRouter } from '../build.js';
import { lockMatches } from '../pins.js';
import { readLock, readRouterWorkspace, workspacePaths } from '../workspace.js';
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

    const read = await readRouterWorkspace(workspace);
    if (!read.success) {
      return output.fail(toFailure(read));
    }
    const { router } = read.data;
    const lock = await readLock(workspace);
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    if (!lockMatches(router, lock.data)) {
      return output.fail({
        message: `${lockFileName} does not pin what ${configFileName} asks for, and a build never changes pins.`,
        input: lockFileName,
        remediation: 'Run `wgc forge lock` to review and pin the changes, then build again.',
      });
    }

    const paths = workspacePaths(workspace, router);
    const built = await buildRouter({
      workspace,
      router,
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

    const localModules = router.modules.length - lock.data.modules.length;
    output.result(
      {
        binary: built.data.binary,
        router: routerSummary(lock.data),
        modules: moduleSummaries(lock.data),
        localModules,
      },
      (data) =>
        `Built ${data.binary}\n  router ${data.router.source} (${data.router.version}), ${router.modules.length} module(s)`,
    );
  });
};
