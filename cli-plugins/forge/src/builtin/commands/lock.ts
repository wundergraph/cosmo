import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { configFileName, lockFileName, renderLock } from '@wundergraph/wgc-plugin-sdk/config';
import { describePinChange, diffPins, resolvePins } from '../pins.js';
import { describeRouterSource, sameSource } from '../sources.js';
import { readLock, readRouterWorkspace, writeLock } from '../workspace.js';
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
        `Reconcile edits to the router modules in ${configFileName}: preview the changes to ${lockFileName}, keep unaffected pins, and apply the accepted changes.`,
      )
      .option('--yes', 'Apply the previewed changes without asking.'),
  ).action(async (options: LockOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const read = await readRouterWorkspace(workspace);
    if (!read.success) {
      return output.fail(toFailure(read));
    }
    const { router } = read.data;
    const previous = await readLock(workspace);
    if (!previous.success) {
      return output.fail(toFailure(previous));
    }

    if (previous.data !== undefined && !sameSource(previous.data.router.source, router.source)) {
      const pinned = describeRouterSource(previous.data.router.source);
      return output.fail({
        message: `${configFileName} selects router ${describeRouterSource(router.source)}, but ${lockFileName} pins router ${pinned}.`,
        input: `${configFileName}: router`,
        remediation: `Restore router ${pinned} in ${configFileName}, then run \`wgc forge router upgrade --config <router.yaml> <candidate>\` to change the router.`,
      });
    }

    const lock = await resolvePins({ router, previous: previous.data, system, output });
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
        kind: 'confirmation',
        message: `${lockFileName} needs changes to match ${configFileName}. Nothing was written.\n${preview}`,
        input: configFileName,
        remediation: 'Review the changes, then run `wgc forge lock --yes` to apply them.',
        next: ['wgc forge lock --yes'],
        data: { ...summary, written: false },
      });
    }

    if (acceptance === 'declined') {
      return output.result({ ...summary, written: false }, () => `Kept ${lockFileName} as it was.`);
    }

    await writeLock(workspace, lock.data);
    output.result({ ...summary, written: true }, () => `Wrote ${lockFileName}\n${preview}`);
  });
};
