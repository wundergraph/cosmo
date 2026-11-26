import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { failWith, ok, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, Output, Result, ToolArgument } from '@wundergraph/wgc-plugin-sdk';
import { configFileName, loadConfig } from '@wundergraph/wgc-plugin-sdk/config';
import type { LoadedConfig } from '@wundergraph/wgc-plugin-sdk/config';
import { announceOperation, asGroup, openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools, logSources, logWaitSeconds } from '../common/contract.js';
import type { LogLine, LogSource } from '../common/contract.js';
import { connectHub } from '../common/hub.js';
import { describeLinkWrite, linkFilePath, locateProjectConfig, writeLink } from '../common/link.js';
import { fetchOperation, followOperation, operationFailure, reportUnfinished } from '../common/operation.js';
import type { HubDependencies } from '../common/runtime.js';
import { resolveAudience, resolveTarget } from '../common/target.js';
import { formatAge } from '../common/time.js';

interface LaunchOptions {
  name?: string;
  from?: string;
  detach?: boolean;
  idempotencyKey?: string;
  initFromGraph?: string;
  config?: string;
  audience?: string;
  json?: boolean;
  input?: boolean;
}

/** What a launch starts from: wundergraph.yaml as found, or with `--init-from-graph` the Hub graph to copy and write it for. */
type LaunchPlan = { kind: 'config'; loaded: LoadedConfig } | { kind: 'graph'; graph: string; target: string };

const planLaunch = async (options: LaunchOptions, cwd: string): Promise<Result<LaunchPlan>> => {
  const located = locateProjectConfig(cwd, options.config);
  if (located !== undefined && existsSync(located)) {
    const loaded = await loadConfig(located);
    return loaded.success ? ok({ kind: 'config', loaded: loaded.data }) : loaded;
  }

  const graph = options.initFromGraph;
  if (graph === undefined) {
    return failWith({
      kind: 'usage',
      message:
        located === undefined
          ? `${configFileName} not found in ${cwd} or any parent directory.`
          : `No ${configFileName} at ${located}.`,
      remediation: `Run \`wgc hub sandbox launch --init-from-graph <graph>\` to create one, or pass --config <path>.`,
    });
  }
  return ok({ kind: 'graph', graph, target: located ?? path.join(cwd, configFileName) });
};

/** What the launch copies: the Cosmo graph of wundergraph.yaml or the `--init-from-graph` schema, or the sandbox `--from` names in it or as `<schema>/<sandbox>`. */
const launchSource = (plan: LaunchPlan, from: string | undefined): Record<string, ToolArgument> => {
  const schema = plan.kind === 'config' ? plan.loaded.config.graph : plan.graph;
  if (from !== undefined) {
    return { from: from.includes('/') ? from : `${schema}/${from}` };
  }
  if (plan.kind === 'graph') {
    return { from: plan.graph };
  }
  return { graph: plan.loaded.config.graph, namespace: plan.loaded.config.namespace };
};

/** Writes the launched sandbox as wundergraph.yaml; Hub exports a sandbox, never a schema. */
const writeSandboxConfig = async (
  hub: HubClient,
  output: Output,
  sandbox: string,
  plan: { graph: string; target: string },
): Promise<Result<string>> => {
  const exported = await hub.callTool(hubTools.exportSandboxConfig, { sandbox }, hubResults.exportSandboxConfig);
  if (!exported.success) {
    return exported;
  }

  await writeFile(plan.target, exported.data.wundergraphYaml);
  const { routerVersion, sources } = exported.data;
  output.message(
    `Created ${configFileName} (router ${routerVersion}, ${sources.length} sources from graph ${plan.graph})\n`,
    { event: 'config_created', path: plan.target, router_version: routerVersion, graph: plan.graph },
  );
  return ok(path.dirname(plan.target));
};

const runLaunch = async (options: LaunchOptions, dependencies: HubDependencies): Promise<void> => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });

  const planned = await planLaunch(options, runtime.cwd());
  if (!planned.success) {
    output.fail(toFailure(planned));
    return;
  }

  const plan = planned.data;
  const graph = plan.kind === 'config' ? plan.loaded.config.graph : plan.graph;
  const name = options.name ?? `${graph}-${runtime.env.USER ?? 'sandbox'}`;
  output.message(`Launching sandbox "${name}"`);

  const hub = connectHub(context, resolveAudience(options, runtime.env));
  const launched = await hub.callTool(
    hubTools.launchSandbox,
    {
      ...launchSource(plan, options.from),
      name,
      idempotency_key: options.idempotencyKey ?? runtime.newIdempotencyKey(),
    },
    hubResults.launchSandbox,
  );
  if (!launched.success) {
    output.fail(toFailure(launched));
    return;
  }

  const { sandbox, operation } = launched.data;
  const dir =
    plan.kind === 'config' ? ok(plan.loaded.dir) : await writeSandboxConfig(hub, output, sandbox.address, plan);
  if (!dir.success) {
    output.fail(toFailure(dir));
    return;
  }

  const link = await writeLink(dir.data, { sandbox: sandbox.address });
  const linked = { path: linkFilePath, ...link };
  announceOperation(output, operation);

  if (options.detach) {
    output.result(
      { sandbox, link: linked, operation: { id: operation.id, status: operation.status } },
      () =>
        [
          `Started sandbox launch ${operation.id}`,
          `  ${operation.url}`,
          `Watch   wgc hub operation watch ${operation.id}`,
          describeLinkWrite(sandbox.address, link),
        ].join('\n'),
      { operation: { id: operation.id, status: operation.status }, url: operation.url },
    );
    return;
  }

  const started = await fetchOperation(hub, operation.id);
  if (!started.success) {
    output.fail(toFailure(started));
    return;
  }

  const followed = await followOperation({ hub, output, runtime, operation: started.data });
  if (!followed.success) {
    output.fail(toFailure(followed));
    return;
  }
  if (followed.data.kind !== 'finished') {
    reportUnfinished(output, followed.data);
    return;
  }

  const finished = followed.data.operation;
  if (finished.status !== 'succeeded') {
    output.fail(operationFailure(finished));
    return;
  }

  output.result(
    { sandbox, link: linked },
    (data) => [`Sandbox ready  ${data.sandbox.endpointUrl}`, describeLinkWrite(sandbox.address, link)].join('\n'),
    {
      operation: { id: finished.id, status: finished.status },
      url: finished.url,
      next: [{ command: 'wgc hub open', description: 'open the sandbox in Hub' }],
    },
  );
};

interface ListOptions {
  schema?: string;
  config?: string;
  audience?: string;
  json?: boolean;
}

const runList = async (options: ListOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const target = await resolveTarget(dependencies.runtime.cwd(), dependencies.runtime.env, options);
  if (!target.success) {
    output.fail(toFailure(target));
    return;
  }

  const hub = connectHub(dependencies.context, target.data.audience);
  const { config, schema } = target.data;
  const scope: Record<string, ToolArgument> =
    options.schema === undefined && config !== undefined
      ? { graph: config.config.graph, namespace: config.config.namespace }
      : { schema };
  const listed = await hub.callTool(hubTools.listSandboxes, scope, hubResults.listSandboxes);
  if (!listed.success) {
    output.fail(toFailure(listed));
    return;
  }

  output.result(listed.data, (data) => {
    if (data.sandboxes.length === 0) {
      return `No sandboxes in ${schema}. Launch one with \`wgc hub sandbox launch\`.`;
    }
    return data.sandboxes
      .map((sandbox) => `${sandbox.address}   ${sandbox.routerStatus}   ${sandbox.endpointUrl}`)
      .join('\n');
  });
};

interface LogsOptions extends SandboxOptions {
  follow?: boolean;
  source?: string[];
}

const isLogSource = (value: string): value is LogSource => (logSources as readonly string[]).includes(value);

const renderLogLine = (line: LogLine): string => `${line.at}  ${line.source.padEnd(7)}  ${line.message}`;

const logEvent = (line: LogLine) => ({
  event: 'log',
  at: line.at,
  level: line.level,
  source: line.source,
  message: line.message,
});

const runLogs = async (options: LogsOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const unknownSource = options.source?.find((source) => !isLogSource(source));
  if (unknownSource !== undefined) {
    output.fail({
      kind: 'usage',
      message: `--source ${unknownSource} is not a log source.`,
      remediation: `Pass one or more of: ${logSources.join(', ')}.`,
      input: '--source',
    });
    return;
  }

  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const args: Record<string, ToolArgument> = { sandbox: selection.sandbox };
  if (options.source !== undefined) {
    args.sources = options.source;
  }

  if (!options.follow) {
    const fetched = await hub.callTool(hubTools.streamLogs, args, hubResults.streamLogs);
    if (!fetched.success) {
      output.fail(toFailure(fetched));
      return;
    }
    const { notice, lines } = fetched.data;
    output.result({ notice, lines }, (data) => data.lines.map((line) => renderLogLine(line)).join('\n'));
    return;
  }

  const abort = new AbortController();
  const stopListening = dependencies.runtime.onInterrupt(() => abort.abort());
  try {
    let cursor: string | undefined;
    while (!abort.signal.aborted) {
      const request: Record<string, ToolArgument> =
        cursor === undefined ? args : { ...args, cursor, wait_seconds: logWaitSeconds };

      const fetched = await hub.callTool(hubTools.streamLogs, request, hubResults.streamLogs, {
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        return;
      }
      if (!fetched.success) {
        output.fail(toFailure(fetched));
        return;
      }

      for (const line of fetched.data.lines) {
        output.record(renderLogLine(line), logEvent(line));
      }
      cursor = fetched.data.cursor;
    }
  } finally {
    stopListening();
  }
};

const runHistory = async (options: SandboxOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const listed = await hub.callTool(
    hubTools.listSandboxHistory,
    { sandbox: selection.sandbox },
    hubResults.listSandboxHistory,
  );
  if (!listed.success) {
    output.fail(toFailure(listed));
    return;
  }

  const now = dependencies.runtime.now();
  output.result(listed.data, (data) => {
    if (data.entries.length === 0) {
      return `No changes to ${selection.sandbox} yet.`;
    }
    const rows = data.entries.map((entry) => [
      `#${entry.seq}`,
      formatAge(entry.createdAt, now),
      entry.agentName ?? entry.author.userId ?? entry.author.kind,
      entry.kind,
      entry.verdict === 'refused' ? `refused: ${entry.refusalReason ?? 'no reason given'}` : 'applied',
    ]);
    const widths = [0, 1, 2, 3].map((column) => Math.max(...rows.map((row) => row[column].length)));
    return rows
      .map((row) => row.map((cell, column) => (column < 4 ? cell.padEnd(widths[column]) : cell)).join('  '))
      .join('\n');
  });
};

const withConfigOptions = (command: Command): Command =>
  command
    .option('--config <path>', 'Path to wundergraph.yaml (default: the nearest one in this or a parent directory)')
    .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: HUB_OIDC_AUDIENCE or hub)')
    .option('--json', 'Machine-readable output');

export const sandboxCommand = (dependencies: HubDependencies): Command =>
  asGroup(new Command('sandbox').description('Launch and inspect Hub sandboxes'), dependencies.context)
    .addCommand(
      withExamples(
        withConfigOptions(
          new Command('launch')
            .description('Launch a sandbox from the graph in wundergraph.yaml and link this directory to it')
            .option('--name <name>', 'Sandbox name (default: <graph>-<user>)')
            .option(
              '--from <sandbox>',
              'Copy this sandbox instead of the schema: a name in the schema or <schema>/<sandbox>',
            )
            .option('--init-from-graph <graph>', 'Create wundergraph.yaml from this Hub graph when there is none')
            .option('--detach', 'Return once Hub accepted the launch; watch it with `wgc hub operation watch`')
            .option('--idempotency-key <key>', 'Repeat a launch safely: Hub returns the first launch for the same key')
            .option('--no-input', 'Never prompt'),
        ),
        ['wgc hub sandbox launch', 'wgc hub sandbox launch --name shop-agent --from shop-nithin --detach --json'],
        'sandbox/launch',
      ).action((options: LaunchOptions) => runLaunch(options, dependencies)),
    )
    .addCommand(
      withExamples(
        withConfigOptions(
          new Command('list')
            .description('List the sandboxes of the schema')
            .option('--schema <slug>', 'Hub schema slug (default: wundergraph.yaml `graph`)'),
        ),
        ['wgc hub sandbox list', 'wgc hub sandbox list --schema shop --json'],
        'sandbox/list',
      ).action((options: ListOptions) => runList(options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(
          new Command('logs')
            .description('Print the latest log lines of the sandbox')
            .option('--follow', 'Keep printing new lines until Ctrl-C')
            .option('--source <source...>', `Only lines of these sources: ${logSources.join(', ')}`),
        ),
        ['wgc hub sandbox logs --follow', 'wgc hub sandbox logs --source router build --json'],
        'sandbox/logs',
      ).action((options: LogsOptions) => runLogs(options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(new Command('history').description('List every change to the sandbox, oldest first')),
        ['wgc hub sandbox history', 'wgc hub sandbox history --sandbox shop/shop-nithin --json'],
        'sandbox/history',
      ).action((options: SandboxOptions) => runHistory(options, dependencies)),
    );
