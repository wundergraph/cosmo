import { Command } from 'commander';
import { execa } from 'execa';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubPages } from '../common/contract.js';
import type { SandboxLocation } from '../common/contract.js';
import { locateSandbox } from '../common/hub.js';
import type { HubDependencies } from '../common/runtime.js';

interface OpenOptions extends SandboxOptions {
  print?: boolean;
}

const targets = ['sandbox', 'history', 'operation', 'proposal'] as const;

type OpenTarget = (typeof targets)[number];

const isTarget = (value: string): value is OpenTarget => (targets as readonly string[]).includes(value);

/** Targets that name one object and need its id, e.g. `operation op_7Kq2`. */
const targetsWithId = new Set<OpenTarget>(['operation', 'proposal']);

const pageUrl = (hubUrl: string, location: SandboxLocation, target: OpenTarget, id: string): string => {
  const pages = hubPages(hubUrl, location);
  const urls: Record<OpenTarget, () => string> = {
    sandbox: () => pages.sandbox,
    history: () => pages.history,
    operation: () => pages.operation(id),
    proposal: () => pages.proposal(id),
  };
  return urls[target]();
};

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
  if (targetsWithId.has(target) && id === undefined) {
    output.fail({
      kind: 'usage',
      message: `Name the ${target} to open.`,
      remediation: `Run \`wgc hub open ${target} <id>\`.`,
    });
    return;
  }

  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const location = await locateSandbox(session.data.hub, session.data.selection);
  if (!location.success) {
    output.fail(toFailure(location));
    return;
  }

  const url = pageUrl(context.endpoints.hubUrl, location.data, target, id ?? '');
  // Only a person at a terminal gets a browser; everyone else gets the URL.
  const browse = context.caller === 'human' && !output.json && options.print !== true;
  const opened = browse ? await openInBrowser(url) : false;
  output.result({ url, opened }, (data) => (data.opened ? `Opened ${data.url}` : data.url), { url });
};

export const openCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('open')
        .description('Open the sandbox, its history, an operation or a proposal in Hub')
        .argument('[target]', `What to open: ${targets.join(', ')}`, 'sandbox')
        .argument('[id]', 'Operation or proposal id')
        .option('--print', 'Print the URL instead of opening a browser'),
    ),
    ['wgc hub open', 'wgc hub open operation op_7Kq2 --print'],
    'open',
  ).action((target: string, id: string | undefined, options: OpenOptions) =>
    runOpen(target, id, options, dependencies),
  );
