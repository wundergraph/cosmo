import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { failWith, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, NextStep, Output, Result, ToolArgument } from '@wundergraph/wgc-plugin-sdk';
import { announceOperation, asGroup, openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools, longPollSeconds } from '../common/contract.js';
import type { LogLine, SandboxDetails } from '../common/contract.js';
import { connectHub } from '../common/hub.js';
import { describeLinkWrite, linkFilePath, locateSandboxConfig, writeLink } from '../common/link.js';
import { followOperation, operationFailure, renderStarted, reportUnfinished } from '../common/operation.js';
import type { HubDependencies } from '../common/runtime.js';
import { defaultAudience, loadSandboxConfig, sandboxFileName } from '../common/sandbox-config.js';
import type { LoadedSandboxConfig } from '../common/sandbox-config.js';
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

/** sandbox.yaml as found, or as written from a Hub graph with `--init-from-graph`. */
const prepareConfig = async (
  options: LaunchOptions,
  dependencies: HubDependencies,
  output: Output,
): Promise<Result<LoadedSandboxConfig>> => {
  const cwd = dependencies.runtime.cwd();
  const located = locateSandboxConfig(cwd, options.config);
  if (located !== undefined && existsSync(located)) {
    return loadSandboxConfig(located);
  }

  const graph = options.initFromGraph;
  if (graph === undefined) {
    return failWith({
      kind: 'usage',
      message:
        located === undefined
          ? `${sandboxFileName} not found in ${cwd} or any parent directory.`
          : `No ${sandboxFileName} at ${located}.`,
      remediation: `Run \`wgc hub sandbox launch --init-from-graph <graph>\` to create one, or pass --config <path>.`,
    });
  }

  const hub = connectHub(dependencies.context, await resolveAudience(cwd, options));
  const exported = await hub.callTool(hubTools.exportSandboxConfig, { graph }, hubResults.exportSandboxConfig);
  if (!exported.success) {
    return exported;
  }

  const target = located ?? path.join(cwd, sandboxFileName);
  await writeFile(target, exported.data.sandboxYaml);
  const { routerVersion, sources } = exported.data;
  output.message(
    `Created ${sandboxFileName} (router ${routerVersion}, ${sources.length} sources from graph ${graph})\n`,
    { event: 'config_created', path: target, router_version: routerVersion, graph },
  );
  return loadSandboxConfig(target);
};

const launchNextSteps = (sandbox: SandboxDetails): NextStep[] => {
  const [collection] = sandbox.collections;
  const steps: NextStep[] = [];
  if (collection !== undefined) {
    steps.push({ command: `wgc hub collection run ${collection}`, description: 'run your saved operations' });
  }
  steps.push({ command: 'wgc hub open', description: 'open the sandbox in Hub' });
  return steps;
};

const describeSandbox = (hub: HubClient, sandboxId: string) =>
  hub.callTool(hubTools.describeSandbox, { sandbox_id: sandboxId }, hubResults.describeSandbox);

const runLaunch = async (options: LaunchOptions, dependencies: HubDependencies): Promise<void> => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });

  const prepared = await prepareConfig(options, dependencies, output);
  if (!prepared.success) {
    output.fail(toFailure(prepared));
    return;
  }

  const { config, raw, dir } = prepared.data;
  const name = options.name ?? `${config.schema}-${runtime.env.USER ?? 'sandbox'}`;
  output.message(`Launching sandbox "${name}"`);

  const hub = connectHub(context, options.audience ?? config.audience ?? defaultAudience);
  const args: Record<string, ToolArgument> = {
    graph: config.schema,
    name,
    sandbox_yaml: raw,
    idempotency_key: options.idempotencyKey ?? runtime.newIdempotencyKey(),
  };
  if (options.from) {
    args.from_sandbox_id = options.from;
  }

  const launched = await hub.callTool(hubTools.launchSandbox, args, hubResults.launchSandbox);
  if (!launched.success) {
    output.fail(toFailure(launched));
    return;
  }

  const { sandbox, operation } = launched.data;
  const link = await writeLink(dir, {
    orgSlug: sandbox.orgSlug,
    graphSlug: sandbox.graphSlug,
    sandboxId: sandbox.sandboxId,
  });
  const linked = { path: linkFilePath, ...link };
  announceOperation(output, operation);

  if (options.detach) {
    output.result(
      { sandbox, link: linked, operation: { id: operation.id, status: operation.status } },
      () => renderStarted(operation, [describeLinkWrite(sandbox.sandboxId, link)]),
      { operation: { id: operation.id, status: operation.status }, url: operation.url },
    );
    return;
  }

  const followed = await followOperation({ hub, output, runtime, operation });
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

  const described = await describeSandbox(hub, sandbox.sandboxId);
  if (!described.success) {
    output.fail(toFailure(described));
    return;
  }

  const ready = described.data.sandbox;
  output.result(
    { sandbox: ready, link: linked },
    (data) =>
      [`Sandbox ready  ${data.sandbox.graphqlUrl ?? data.sandbox.url}`, describeLinkWrite(ready.sandboxId, link)].join(
        '\n',
      ),
    {
      operation: { id: finished.id, status: finished.status },
      url: finished.url,
      next: launchNextSteps(ready),
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
  const target = await resolveTarget(dependencies.runtime.cwd(), options);
  if (!target.success) {
    output.fail(toFailure(target));
    return;
  }

  const hub = connectHub(dependencies.context, target.data.audience);
  const listed = await hub.callTool(hubTools.listSandboxes, { graph: target.data.schema }, hubResults.listSandboxes);
  if (!listed.success) {
    output.fail(toFailure(listed));
    return;
  }

  output.result(listed.data, (data) => {
    if (data.sandboxes.length === 0) {
      return `No sandboxes in ${target.data.schema}. Launch one with \`wgc hub sandbox launch\`.`;
    }
    return data.sandboxes
      .map((sandbox) => `${sandbox.name} (${sandbox.sandboxId})   ${sandbox.status}   ${sandbox.graphqlUrl ?? ''}`)
      .map((line) => line.trimEnd())
      .join('\n');
  });
};

interface LogsOptions extends SandboxOptions {
  follow?: boolean;
  since?: string;
  router?: boolean;
  forge?: boolean;
}

const renderLogLine = (line: LogLine): string => `${line.at}  ${line.component.padEnd(6)}  ${line.message}`;

const logEvent = (line: LogLine) => ({ event: 'log', at: line.at, component: line.component, message: line.message });

const runLogs = async (options: LogsOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const args: Record<string, ToolArgument> = { sandbox_id: selection.sandboxId };
  if (options.since) {
    args.since = options.since;
  }
  if (options.router || options.forge) {
    args.component = options.router ? 'router' : 'forge';
  }

  if (!options.follow) {
    const fetched = await hub.callTool(hubTools.getSandboxLogs, args, hubResults.getSandboxLogs);
    if (!fetched.success) {
      output.fail(toFailure(fetched));
      return;
    }
    output.result({ lines: fetched.data.lines }, (data) => data.lines.map((line) => renderLogLine(line)).join('\n'));
    return;
  }

  const abort = new AbortController();
  const stopListening = dependencies.runtime.onInterrupt(() => abort.abort());
  try {
    let cursor: string | null = null;
    while (!abort.signal.aborted) {
      const request: Record<string, ToolArgument> = { ...args, wait_seconds: longPollSeconds };
      if (cursor !== null) {
        request.cursor = cursor;
      }

      const fetched = await hub.callTool(hubTools.getSandboxLogs, request, hubResults.getSandboxLogs, {
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
      cursor = fetched.data.nextCursor ?? cursor;
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
    { sandbox_id: selection.sandboxId },
    hubResults.listSandboxHistory,
  );
  if (!listed.success) {
    output.fail(toFailure(listed));
    return;
  }

  const now = dependencies.runtime.now();
  output.result(listed.data, (data) => {
    if (data.entries.length === 0) {
      return `No changes to ${selection.sandboxId} yet.`;
    }
    const rows = data.entries.map((entry) => [
      entry.version,
      formatAge(entry.at, now),
      entry.surface,
      entry.actor,
      entry.summary,
    ]);
    const widths = [0, 1, 2, 3].map((column) => Math.max(...rows.map((row) => row[column].length)));
    return rows
      .map((row) => row.map((cell, column) => (column < 4 ? cell.padEnd(widths[column]) : cell)).join('  '))
      .join('\n');
  });
};

const withConfigOptions = (command: Command): Command =>
  command
    .option('--config <path>', 'Path to sandbox.yaml (default: the nearest one in this or a parent directory)')
    .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: sandbox.yaml `audience` or hub)')
    .option('--json', 'Machine-readable output');

export const sandboxCommand = (dependencies: HubDependencies): Command =>
  asGroup(new Command('sandbox').description('Launch and inspect Hub sandboxes'), dependencies.context)
    .addCommand(
      withExamples(
        withConfigOptions(
          new Command('launch')
            .description('Launch a sandbox from sandbox.yaml and link this directory to it')
            .option('--name <name>', 'Sandbox name (default: <graph>-<user>)')
            .option('--from <sandbox>', 'Copy the data and settings of this sandbox')
            .option('--init-from-graph <graph>', 'Create sandbox.yaml from this Hub graph when there is none')
            .option('--detach', 'Return once Hub accepted the launch; watch it with `wgc hub operation watch`')
            .option('--idempotency-key <key>', 'Repeat a launch safely: Hub returns the first launch for the same key')
            .option('--no-input', 'Never prompt'),
        ),
        ['wgc hub sandbox launch', 'wgc hub sandbox launch --name shop-agent --from sb_3fd1 --detach --json'],
        'sandbox/launch',
      ).action((options: LaunchOptions) => runLaunch(options, dependencies)),
    )
    .addCommand(
      withExamples(
        withConfigOptions(
          new Command('list')
            .description('List the sandboxes of the graph')
            .option('--schema <slug>', 'Hub graph slug (default: sandbox.yaml `schema`)'),
        ),
        ['wgc hub sandbox list', 'wgc hub sandbox list --schema shop --json'],
        'sandbox/list',
      ).action((options: ListOptions) => runList(options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(
          new Command('logs')
            .description('Print the router and Forge logs of the sandbox')
            .option('--follow', 'Keep printing new lines until Ctrl-C')
            .option('--since <duration>', 'Only lines newer than this, e.g. 10m')
            .option('--router', 'Only router lines')
            .option('--forge', 'Only Forge lines'),
        ),
        ['wgc hub sandbox logs --follow', 'wgc hub sandbox logs --since 10m --router --json'],
        'sandbox/logs',
      ).action((options: LogsOptions) => runLogs(options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(new Command('history').description('List every change to the sandbox, newest first')),
        ['wgc hub sandbox history', 'wgc hub sandbox history --sandbox sb_3fd1 --json'],
        'sandbox/history',
      ).action((options: SandboxOptions) => runHistory(options, dependencies)),
    );
