import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import type { HubDependencies } from '../common/runtime.js';

const runPropose = async (options: SandboxOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const proposed = await hub.callTool(
    hubTools.createProposal,
    { sandbox: selection.sandbox },
    hubResults.createProposal,
  );
  if (!proposed.success) {
    output.fail(toFailure(proposed));
    return;
  }

  output.result({ sandbox: selection.sandbox }, (data) => `Created a proposal from sandbox ${data.sandbox}`, {
    changed: proposed.data.ok,
    next: [{ command: 'wgc hub open proposal', description: 'review it in Hub' }],
  });
};

export const proposeCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('propose').description('Open a Hub proposal for the committed schema changes of the sandbox'),
    ),
    ['wgc hub propose', 'wgc hub propose --sandbox shop/shop-nithin --json'],
    'propose',
  ).action((options: SandboxOptions) => runPropose(options, dependencies));
