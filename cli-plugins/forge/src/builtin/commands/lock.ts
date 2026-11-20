import type { Command } from 'commander';
import { toFailure } from '../failure.js';
import { lockFileName, readLock, renderLock, writeLock } from '../lock.js';
import { describeRouterSource, manifestFileName, readManifest, sameSource } from '../manifest.js';
import { describePinChange, diffPins, resolvePins } from '../pins.js';
import { askToAccept, moduleSummaries, routerSummary, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface LockOptions extends CommonOptions {
  yes?: boolean;
}

export const registerLock = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('lock')
      .description(
        'Reconcile edits to the module list in forge.yaml: preview the changes to forge.lock, keep unaffected pins, and apply the accepted changes.',
      )
      .option('--yes', 'Apply the previewed changes without asking.'),
  ).action(async (options: LockOptions) => {
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

    if (previous.data !== undefined && !sameSource(previous.data.router.source, manifest.data.router)) {
      const pinned = describeRouterSource(previous.data.router.source);
      return output.fail({
        message: `${manifestFileName} selects router ${describeRouterSource(manifest.data.router)}, but ${lockFileName} pins router ${pinned}.`,
        input: `${manifestFileName}: router`,
        fix: `Restore router ${pinned} in ${manifestFileName}, then run \`wgc forge router upgrade --config <router.yaml> <candidate>\` to change the router.`,
      });
    }

    const lock = await resolvePins({ manifest: manifest.data, previous: previous.data, system, output });
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }

    const changes = diffPins(previous.data?.modules ?? [], lock.data.modules);
    const summary = { router: routerSummary(lock.data), modules: moduleSummaries(lock.data), changes };
    if (previous.data !== undefined && renderLock(previous.data) === renderLock(lock.data)) {
      return output.result({ ...summary, written: false }, () => `${lockFileName} is up to date.`);
    }

    const preview = [
      ...(previous.data === undefined ? [`+ router ${summary.router.source} ${summary.router.version}`] : []),
      ...changes.map((change) => describePinChange(change)),
    ].join('\n');
    const acceptance = await askToAccept(context, options, `${preview}\nWrite these changes to ${lockFileName}?`);

    if (acceptance === 'needs-yes') {
      return output.fail({
        message: `${lockFileName} needs changes to match ${manifestFileName}. Nothing was written.\n${preview}`,
        input: manifestFileName,
        fix: 'Review the changes, then run `wgc forge lock --yes` to apply them.',
        details: { ...summary, written: false },
      });
    }

    if (acceptance === 'declined') {
      return output.result({ ...summary, written: false }, () => `Kept ${lockFileName} as it was.`);
    }

    await writeLock(workspace, lock.data);
    output.result({ ...summary, written: true }, () => `Wrote ${lockFileName}\n${preview}`);
  });
};
