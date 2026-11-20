import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import type { HubDependencies } from '../common/runtime.js';

const labelWidth = 12;

const runStatus = async (options: SandboxOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const described = await hub.callTool(hubTools.getSandbox, { sandbox: selection.sandbox }, hubResults.getSandbox);
  if (!described.success) {
    output.fail(toFailure(described));
    return;
  }

  output.result(described.data, (sandbox) =>
    [
      ['Sandbox', sandbox.address],
      ['Router', sandbox.routerStatus],
      ['Endpoint', sandbox.endpointUrl],
    ]
      .map(([label, value]) => `${label.padEnd(labelWidth)}${value}`)
      .join('\n'),
  );
};

export const statusCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('status').description('Show the linked sandbox: its router status and GraphQL endpoint'),
    ),
    ['wgc hub status', 'wgc hub status --sandbox shop/shop-nithin --json'],
    'status',
  ).action((options: SandboxOptions) => runStatus(options, dependencies));
