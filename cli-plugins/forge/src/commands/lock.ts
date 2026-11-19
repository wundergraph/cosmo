import type { Command } from 'commander';
import { toFailure } from '../failure.js';
import { lockFileName, readLock, writeLock } from '../lock.js';
import { readManifest } from '../manifest.js';
import { resolvePins } from '../pins.js';
import { moduleSummaries, routerSummary, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

export const registerLock = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('lock')
      .description('Resolve the router and every remote module again and write the pins to forge.lock.'),
  ).action(async (options: CommonOptions) => {
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

    const lock = await resolvePins({ manifest: manifest.data, previous: previous.data, refresh: true, system, output });
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    await writeLock(workspace, lock.data);

    output.result({ router: routerSummary(lock.data), modules: moduleSummaries(lock.data) }, (data) =>
      [
        `Wrote ${lockFileName}`,
        `  router ${data.router.source} -> ${data.router.version} (${data.router.commit})`,
        ...data.modules.map((module) => `  ${module.package} -> ${module.version}`),
      ].join('\n'),
    );
  });
};
