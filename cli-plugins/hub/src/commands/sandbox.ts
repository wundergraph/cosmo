import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { failure, ok } from '@wundergraph/wgc-plugin-sdk';
import type { PluginContext, Result, ToolArgument } from '@wundergraph/wgc-plugin-sdk';
import { reportFailure } from '../common/failure.js';
import { connectHub, getSandboxResult, launchSandboxResult, listSandboxesResult, Sandbox } from '../common/hub.js';
import { defaultAudience, sandboxFileName } from '../common/sandbox-config.js';
import { resolveTarget, TargetOptions } from '../common/target.js';

interface SandboxOptions extends TargetOptions {
  json?: boolean;
}

interface LaunchOptions extends SandboxOptions {
  from?: string;
  graph?: string;
  namespace: string;
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

/** Opens the sandbox for a person at a terminal; everyone else gets the URL in the result. */
const openInBrowser = async (url: string, json: boolean, context: PluginContext): Promise<boolean> => {
  if (context.caller !== 'human' || json) {
    return false;
  }
  const browser = browserCommand(url);
  return (await execa(browser.file, browser.args, { reject: false })).exitCode === 0;
};

const launchArguments = async (
  name: string | undefined,
  options: LaunchOptions,
): Promise<
  Result<{
    tool: 'launch_sandbox' | 'create_sandbox';
    args: Record<string, ToolArgument>;
    audience: string;
    label: string;
  }>
> => {
  if (options.graph) {
    const args: Record<string, ToolArgument> = { graph: options.graph, namespace: options.namespace };
    if (name) {
      args.name = name;
    }
    return ok({
      tool: 'launch_sandbox',
      args,
      audience: options.audience ?? defaultAudience,
      label: `${options.namespace}/${options.graph}`,
    });
  }

  if (!name) {
    return failure('Name the sandbox, or pass `--graph <name>` to launch one from a Cosmo federated graph.');
  }
  const target = await resolveTarget(options);
  if (!target.success) {
    return target;
  }
  const subgraphs: ToolArgument[] = (target.data.config?.subgraphs ?? []).flatMap((subgraph) =>
    subgraph.url ? [{ name: subgraph.name, url: subgraph.url }] : [],
  );
  const args: Record<string, ToolArgument> = { schema: target.data.schema, name, subgraphs };
  if (options.from) {
    args.from = options.from;
  }
  return ok({ tool: 'create_sandbox', args, audience: target.data.audience, label: target.data.schema });
};

const runLaunch = async (name: string | undefined, options: LaunchOptions, context: PluginContext): Promise<void> => {
  const output = context.output({ json: options.json });
  const launch = await launchArguments(name, options);
  if (!launch.success) {
    reportFailure(output, launch.errors);
    return;
  }

  output.progress({
    step: 'launch',
    subject: name ?? launch.data.label,
    message: `Launching a sandbox from ${launch.data.label}`,
  });
  const launched = await connectHub(context, launch.data.audience).callTool(
    launch.data.tool,
    launch.data.args,
    launchSandboxResult,
  );
  if (!launched.success) {
    reportFailure(output, launched.errors);
    return;
  }

  const opened = await openInBrowser(launched.data.sandbox.url, output.json, context);
  output.result({ ...launched.data, opened }, (data) =>
    [`${pc.green('Launched')} ${renderSandbox(data.sandbox)}`, data.opened ? pc.dim('Opened in your browser.') : '']
      .filter((line) => line !== '')
      .join('\n'),
  );
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
      ? pc.dim(`No sandboxes in ${target.data.schema}. Launch one with \`wgc hub sandbox launch <name>\`.`)
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

  const opened = await openInBrowser(found.data.sandbox.url, output.json, context);
  output.result({ ...found.data, opened }, (data) =>
    data.opened ? `Opened ${data.sandbox.url}` : `${data.sandbox.url}\n${pc.dim('Open this URL in a browser.')}`,
  );
};

export const sandboxCommand = (context: PluginContext): Command =>
  new Command('sandbox')
    .description('Launch, list and open Hub sandboxes')
    .addCommand(
      withTargetOptions(
        new Command('launch')
          .description(
            'Launch a sandbox from a Cosmo federated graph (--graph), or from sandbox.yaml, where subgraphs with a `url` route there and the rest are mocked',
          )
          .argument('[name]', 'Sandbox name (required without --graph)')
          .option('--graph <name>', 'Launch from this Cosmo federated graph')
          .option('-n, --namespace <namespace>', 'Namespace of the federated graph', 'default')
          .option('--from <sandbox>', 'Copy the schema and settings of this sandbox (without --graph)'),
      ).action((name: string | undefined, options: LaunchOptions) => runLaunch(name, options, context)),
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
