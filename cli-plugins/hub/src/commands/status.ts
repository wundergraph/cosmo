import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import type { SandboxDetails } from '../common/contract.js';
import type { HubDependencies } from '../common/runtime.js';
import { formatAge } from '../common/time.js';

const labelWidth = 12;

const routerLine = (sandbox: SandboxDetails): string => {
  const latest = sandbox.latestRouterVersion;
  if (latest === null || latest === sandbox.routerVersion) {
    return sandbox.routerVersion;
  }
  return `${sandbox.routerVersion}   (latest ${latest}, run \`wgc forge router upgrade\`)`;
};

const lastOperationLine = (sandbox: SandboxDetails, now: Date): string | undefined => {
  const operation = sandbox.lastOperation;
  if (operation === null) {
    return undefined;
  }
  const when = operation.finishedAt === null ? '' : ` ${formatAge(operation.finishedAt, now)}`;
  return `${operation.kind}  ${operation.status}${when}   ${operation.id}`;
};

export const renderStatus = (sandbox: SandboxDetails, now: Date): string => {
  const rows: Array<[string, string | undefined]> = [
    ['Sandbox', `${sandbox.name} (${sandbox.sandboxId})   ${sandbox.status}`],
    ['Graph', `${sandbox.orgSlug}/${sandbox.graphSlug}`],
    ['Router', routerLine(sandbox)],
    ['Sources', sandbox.sources.map((source) => `${source.name} ${source.status === 'ok' ? '✓' : '✗'}`).join('  ')],
    ['Last op', lastOperationLine(sandbox, now)],
    ['URL', sandbox.url],
  ];
  return rows
    .filter((row): row is [string, string] => row[1] !== undefined && row[1] !== '')
    .map(([label, value]) => `${label.padEnd(labelWidth)}${value}`)
    .join('\n');
};

const runStatus = async (options: SandboxOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const described = await hub.callTool(
    hubTools.describeSandbox,
    { sandbox_id: selection.sandboxId },
    hubResults.describeSandbox,
  );
  if (!described.success) {
    output.fail(toFailure(described));
    return;
  }

  const now = dependencies.runtime.now();
  output.result(described.data, (data) => renderStatus(data.sandbox, now), { url: described.data.sandbox.url });
};

export const statusCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('status').description('Show the linked sandbox: status, router version, sources, last operation'),
    ),
    ['wgc hub status', 'wgc hub status --sandbox sb_3fd1 --json'],
    'status',
  ).action((options: SandboxOptions) => runStatus(options, dependencies));
