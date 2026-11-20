import { Command } from 'commander';
import { execa } from 'execa';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubPages, hubResults, hubTools } from '../common/contract.js';
import type { HubDependencies } from '../common/runtime.js';

interface OpenOptions extends SandboxOptions {
  print?: boolean;
}

const targets = ['sandbox', 'operation', 'proposal'] as const;

type OpenTarget = (typeof targets)[number];

const isTarget = (value: string): value is OpenTarget => (targets as readonly string[]).includes(value);

const browserCommand = (url: string): { file: string; args: string[] } => {
  if (process.platform === 'darwin') {
    return { file: 'open', args: [url] };
  }
  if (process.platform === 'win32') {
    return { file: 'cmd', args: ['/c', 'start', '""', url] };
  }
  return { file: 'xdg-open', args: [url] };
};

const openInBrowser = async (url: string): Promise<boolean> => {
  const browser = browserCommand(url);
  return (await execa(browser.file, browser.args, { reject: false })).exitCode === 0;
};

const runOpen = async (
  target: string,
  id: string | undefined,
  options: OpenOptions,
  dependencies: HubDependencies,
): Promise<void> => {
  const { context } = dependencies;
  const output = context.output({ json: options.json });
  if (!isTarget(target)) {
    output.fail({
      kind: 'usage',
      message: `Cannot open ${target}.`,
      remediation: `Open one of: ${targets.join(', ')}.`,
    });
    return;
  }
  if (target === 'operation' && id === undefined) {
    output.fail({
      kind: 'usage',
      message: 'Name the operation to open.',
      remediation: 'Run `wgc hub open operation <id>`.',
    });
    return;
  }

  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const access = await session.data.hub.callTool(hubTools.describeCurrentAccess, {}, hubResults.describeCurrentAccess);
  if (!access.success) {
    output.fail(toFailure(access));
    return;
  }

  const pages = hubPages(context.endpoints.hubUrl, access.data.organizationSlug, session.data.selection.sandbox);
  const urls: Record<OpenTarget, () => string> = {
    sandbox: () => pages.sandbox,
    operation: () => pages.operation(id ?? ''),
    proposal: () => pages.proposal,
  };
  const url = urls[target]();
  // Only a person at a terminal gets a browser; everyone else gets the URL.
  const browse = context.caller === 'human' && !output.json && options.print !== true;
  const opened = browse ? await openInBrowser(url) : false;
  output.result({ url, opened }, (data) => (data.opened ? `Opened ${data.url}` : data.url), { url });
};

export const openCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('open')
        .description('Open the sandbox, one of its operations or its proposal in Hub')
        .argument('[target]', `What to open: ${targets.join(', ')}`, 'sandbox')
        .argument('[id]', 'Operation id')
        .option('--print', 'Print the URL instead of opening a browser'),
    ),
    ['wgc hub open', 'wgc hub open operation op_7Kq2 --print'],
    'open',
  ).action((target: string, id: string | undefined, options: OpenOptions) =>
    runOpen(target, id, options, dependencies),
  );
