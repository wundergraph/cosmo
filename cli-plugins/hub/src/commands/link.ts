import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { withExamples } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import { connectHub } from '../common/hub.js';
import { describeLinkWrite, linkFilePath, projectDirectory, removeLink, writeLink } from '../common/link.js';
import type { HubDependencies } from '../common/runtime.js';
import { resolveAudience } from '../common/target.js';

interface LinkOptions {
  config?: string;
  audience?: string;
  json?: boolean;
  input?: boolean;
}

const runLink = async (sandbox: string | undefined, options: LinkOptions, dependencies: HubDependencies) => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });
  if (sandbox === undefined) {
    output.fail({
      kind: 'usage',
      message: 'Name the sandbox to link this directory to.',
      remediation: 'Run `wgc hub link <sandbox>`; `wgc hub sandbox list` shows the sandboxes.',
      next: ['wgc hub sandbox list'],
    });
    return;
  }

  const cwd = runtime.cwd();
  const hub = connectHub(context, resolveAudience(options, runtime.env));
  const found = await hub.callTool(hubTools.getSandbox, { sandbox }, hubResults.getSandbox);
  if (!found.success) {
    output.fail(toFailure(found));
    return;
  }

  const { address } = found.data;
  const write = await writeLink(projectDirectory(cwd, options.config), { sandbox: address });

  output.result(
    { sandbox: address, link: { path: linkFilePath, ...write } },
    (data) => describeLinkWrite(data.sandbox, data.link),
    { changed: write.changed },
  );
};

const runUnlink = async (options: LinkOptions, dependencies: HubDependencies) => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });
  const removed = await removeLink(projectDirectory(runtime.cwd(), options.config));

  output.result(
    { removed },
    (data) => (data.removed ? `Removed ${linkFilePath}` : `This directory is not linked (no ${linkFilePath}).`),
    { changed: removed },
  );
};

export const linkCommands = (dependencies: HubDependencies): Command[] => [
  withExamples(
    new Command('link')
      .description('Link this directory to a sandbox (.wgc/link.json, gitignored)')
      .argument('[sandbox]', 'Sandbox as <schema>/<sandbox>')
      .option('--config <path>', 'Path to wundergraph.yaml; the link goes next to it')
      .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: HUB_OIDC_AUDIENCE or hub)')
      .option('--no-input', 'Never prompt')
      .option('--json', 'Machine-readable output'),
    ['wgc hub link shop/shop-nithin', 'wgc hub link shop/shop-nithin --json'],
    'link',
  ).action((sandbox: string | undefined, options: LinkOptions) => runLink(sandbox, options, dependencies)),
  new Command('unlink')
    .description('Remove the link between this directory and its sandbox')
    .option('--config <path>', 'Path to wundergraph.yaml; the link sits next to it')
    .option('--json', 'Machine-readable output')
    .action((options: LinkOptions) => runUnlink(options, dependencies)),
];
