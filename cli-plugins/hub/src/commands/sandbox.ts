import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import type { PluginContext, ToolArgument } from '@wundergraph/wgc-plugin-sdk';
import { reportFailure } from '../common/failure.js';
import { connectHub, createSandboxResult, getSandboxResult, listSandboxesResult, Sandbox } from '../common/hub.js';
import { sandboxFileName } from '../common/sandbox-config.js';
import { resolveTarget, TargetOptions } from '../common/target.js';

interface SandboxOptions extends TargetOptions {
  json?: boolean;
}

interface CreateOptions extends SandboxOptions {
  from?: string;
}

const renderSandbox = (sandbox: Sandbox): string =>
  [
    `${pc.bold(sandbox.name)} ${pc.dim(sandbox.status)}`,
    `  hub     ${sandbox.url}`,
    `  router  ${sandbox.routerUrl ?? pc.dim('not running')}`,
  ].join('\n');

const browserCommand = (url: string): { file: string; args: string[] } => {
  if (process.platform === 'darwin') {
    return { file: 'open', args: [url] };
  }
  if (process.platform === 'win32') {
    return { file: 'cmd', args: ['/c', 'start', '""', url] };
  }
  return { file: 'xdg-open', args: [url] };
};

const withTargetOptions = (command: Command): Command =>
  command
    .option('--schema <slug>', 'Hub schema slug (default: sandbox.yaml `schema`)')
    .option('--config <path>', 'Path to sandbox.yaml', sandboxFileName)
    .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: sandbox.yaml `audience` or hub)')
    .option('--json', 'Print the result as JSON');

const runCreate = async (name: string, options: CreateOptions, context: PluginContext): Promise<void> => {
  const output = context.output({ json: options.json });
  const target = await resolveTarget(options);
  if (!target.success) {
    reportFailure(output, target.errors);
    return;
  }

  const subgraphs: ToolArgument[] = (target.data.config?.subgraphs ?? []).flatMap((subgraph) =>
    subgraph.url ? [{ name: subgraph.name, url: subgraph.url }] : [],
  );
  const args: Record<string, ToolArgument> = { schema: target.data.schema, name, subgraphs };
  if (options.from) {
    args.from = options.from;
  }

  output.progress({ step: 'create', subject: name, message: `Creating sandbox in ${target.data.schema}` });
  const created = await connectHub(context, target.data.audience).callTool('create_sandbox', args, createSandboxResult);
  if (!created.success) {
    reportFailure(output, created.errors);
    return;
  }
  output.result(created.data, (data) => `${pc.green('Created')} ${renderSandbox(data.sandbox)}`);
};

const runList = async (options: SandboxOptions, context: PluginContext): Promise<void> => {
  const output = context.output({ json: options.json });
  const target = await resolveTarget(options);
  if (!target.success) {
    reportFailure(output, target.errors);
    return;
  }

  const listed = await connectHub(context, target.data.audience).callTool(
    'list_sandboxes',
    { schema: target.data.schema },
    listSandboxesResult,
  );
  if (!listed.success) {
    reportFailure(output, listed.errors);
    return;
  }
  output.result(listed.data, (data) =>
    data.sandboxes.length === 0
      ? pc.dim(`No sandboxes in ${target.data.schema}. Create one with \`wgc hub sandbox create <name>\`.`)
      : data.sandboxes.map((sandbox) => renderSandbox(sandbox)).join('\n'),
  );
};

const runOpen = async (name: string, options: SandboxOptions, context: PluginContext): Promise<void> => {
  const output = context.output({ json: options.json });
  const target = await resolveTarget(options);
  if (!target.success) {
    reportFailure(output, target.errors);
    return;
  }

  const found = await connectHub(context, target.data.audience).callTool(
    'get_sandbox',
    { schema: target.data.schema, name },
    getSandboxResult,
  );
  if (!found.success) {
    reportFailure(output, found.errors);
    return;
  }

  const { url } = found.data.sandbox;
  let opened = false;
  if (context.caller === 'human' && !output.json) {
    const browser = browserCommand(url);
    opened = (await execa(browser.file, browser.args, { reject: false })).exitCode === 0;
  }
  output.result({ ...found.data, opened }, (data) =>
    data.opened ? `Opened ${data.sandbox.url}` : `${data.sandbox.url}\n${pc.dim('Open this URL in a browser.')}`,
  );
};

export const sandboxCommand = (context: PluginContext): Command =>
  new Command('sandbox')
    .description('Create, list and open Hub sandboxes')
    .addCommand(
      withTargetOptions(
        new Command('create')
          .description('Create a sandbox; subgraphs with a `url` in sandbox.yaml route there, the rest are mocked')
          .argument('<name>', 'Sandbox name')
          .option('--from <sandbox>', 'Copy the schema and settings of this sandbox'),
      ).action((name: string, options: CreateOptions) => runCreate(name, options, context)),
    )
    .addCommand(
      withTargetOptions(new Command('list').description('List the sandboxes of the schema')).action(
        (options: SandboxOptions) => runList(options, context),
      ),
    )
    .addCommand(
      withTargetOptions(
        new Command('open').description('Open a sandbox in Hub').argument('<name>', 'Sandbox name'),
      ).action((name: string, options: SandboxOptions) => runOpen(name, options, context)),
    );
