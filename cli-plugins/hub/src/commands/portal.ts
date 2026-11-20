import { Command } from 'commander';
import { failWith, ok, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, Output, Result } from '@wundergraph/wgc-plugin-sdk';
import { asGroup, openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import type { Portal } from '../common/contract.js';
import { locateSandbox } from '../common/hub.js';
import type { SandboxSelection } from '../common/link.js';
import { runTunnel } from '../common/portal-tunnel.js';
import type { HubDependencies } from '../common/runtime.js';
import { formatAge } from '../common/time.js';

interface OpenOptions extends SandboxOptions {
  port?: string;
  url?: string;
}

/** `<schema>/<sandbox>`, as Hub's tools name a sandbox: `--sandbox` may already be one. */
const sandboxAddress = async (hub: HubClient, selection: SandboxSelection): Promise<Result<string>> => {
  if (selection.sandboxId.includes('/')) {
    return ok(selection.sandboxId);
  }

  const located = await locateSandbox(hub, selection);
  if (!located.success) {
    return located;
  }
  return ok(`${located.data.graphSlug}/${located.data.sandboxId}`);
};

/** Where the local subgraph answers: `--url`, or `/graphql` on `--port` of localhost. */
const localUrlOf = (options: OpenOptions): Result<string> => {
  if (options.url !== undefined && options.port !== undefined) {
    return failWith({ kind: 'usage', message: 'Pass either --port or --url, not both.' });
  }

  if (options.url !== undefined) {
    if (!URL.canParse(options.url)) {
      return failWith({ kind: 'usage', message: `--url ${options.url} is not a URL.`, input: '--url' });
    }
    return ok(options.url);
  }

  if (options.port !== undefined) {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      return failWith({ kind: 'usage', message: `--port ${options.port} is not a port.`, input: '--port' });
    }
    return ok(`http://localhost:${port}/graphql`);
  }

  return failWith({
    kind: 'usage',
    message: 'Tell wgc where your subgraph runs.',
    remediation: 'Pass --port <port> for http://localhost:<port>/graphql, or --url <url>.',
  });
};

/** The WebSocket URL of the tunnel, on the Hub URL wgc already talks to. */
const tunnelUrlOf = (hubUrl: string, tunnelPath: string): string => {
  const url = new URL(tunnelPath, hubUrl.endsWith('/') ? hubUrl : `${hubUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const describePortal = (portal: Portal) => ({
  id: portal.portalId,
  subgraph: portal.subgraph,
  status: portal.status,
});

/** Closes the portal on Ctrl-C, so the sandbox goes back to serving the subgraph as before. */
const closeOnInterrupt = async (
  hub: HubClient,
  output: Output,
  params: { address: string; subgraph: string; dashboardUrl: string },
): Promise<void> => {
  const closed = await hub.callTool(
    hubTools.closePortal,
    { sandbox: params.address, subgraph: params.subgraph },
    hubResults.closePortal,
  );
  if (!closed.success) {
    output.fail(toFailure(closed));
    return;
  }

  output.fail({
    kind: 'interrupted',
    code: 'PORTAL_CLOSED',
    message: `Closed the portal. ${params.address} serves ${params.subgraph} as before.`,
    url: params.dashboardUrl,
    data: { portal: describePortal(closed.data.portal) },
  });
};

const runOpen = async (subgraph: string, options: OpenOptions, dependencies: HubDependencies): Promise<void> => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });

  const localUrl = localUrlOf(options);
  if (!localUrl.success) {
    output.fail(toFailure(localUrl));
    return;
  }

  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const address = await sandboxAddress(hub, selection);
  if (!address.success) {
    output.fail(toFailure(address));
    return;
  }

  const opened = await hub.callTool(hubTools.openPortal, { sandbox: address.data, subgraph }, hubResults.openPortal);
  if (!opened.success) {
    output.fail(toFailure(opened));
    return;
  }

  const { portal, credential, tunnelPath, dashboardUrl } = opened.data;
  output.message(`  ${dashboardUrl}\n`, { event: 'portal', id: portal.portalId, url: dashboardUrl });
  output.message(`Portal ${subgraph} in ${address.data} -> ${localUrl.data}. Ctrl-C closes it.`, {
    event: 'portal_status',
    status: portal.status,
  });

  const ended = await runTunnel({
    tunnelUrl: tunnelUrlOf(context.endpoints.hubUrl, tunnelPath),
    credential,
    localUrl: localUrl.data,
    clientVersion: context.cliVersion,
    output,
    runtime,
  });

  if (ended.kind === 'interrupted') {
    await closeOnInterrupt(hub, output, { address: address.data, subgraph, dashboardUrl });
    return;
  }

  if (ended.kind === 'refused') {
    output.fail({
      code: ended.code,
      message: ended.message,
      next: [`wgc hub portal open ${subgraph}`],
      url: dashboardUrl,
    });
    return;
  }

  output.result(
    { portal: { ...describePortal(portal), status: 'closed' }, reason: ended.reason },
    (data) => `The portal was closed in Hub (${data.reason}). ${address.data} serves ${subgraph} as before.`,
    { url: dashboardUrl },
  );
};

const runClose = async (subgraph: string, options: SandboxOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const address = await sandboxAddress(session.data.hub, session.data.selection);
  if (!address.success) {
    output.fail(toFailure(address));
    return;
  }

  const closed = await session.data.hub.callTool(
    hubTools.closePortal,
    { sandbox: address.data, subgraph },
    hubResults.closePortal,
  );
  if (!closed.success) {
    output.fail(toFailure(closed));
    return;
  }

  output.result(
    { portal: describePortal(closed.data.portal) },
    () => `Closed the portal. ${address.data} serves ${subgraph} as before.`,
    { changed: true },
  );
};

const renderPortals = (portals: Portal[], now: Date): string => {
  if (portals.length === 0) {
    return 'No portals. Open one with `wgc hub portal open <subgraph> --port <port>`.';
  }

  const rows = portals.map((portal) => [
    portal.subgraph,
    portal.status,
    portal.lastRequestAt === null ? '-' : formatAge(portal.lastRequestAt, now),
  ]);
  const header = ['SUBGRAPH', 'STATUS', 'LAST REQUEST'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] + 2))
        .join('')
        .trimEnd(),
    )
    .join('\n');
};

const runList = async (options: SandboxOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const address = await sandboxAddress(session.data.hub, session.data.selection);
  if (!address.success) {
    output.fail(toFailure(address));
    return;
  }

  const listed = await session.data.hub.callTool(
    hubTools.listPortals,
    { sandbox: address.data },
    hubResults.listPortals,
  );
  if (!listed.success) {
    output.fail(toFailure(listed));
    return;
  }

  output.result({ portals: listed.data.portals }, (data) => renderPortals(data.portals, dependencies.runtime.now()));
};

export const portalCommand = (dependencies: HubDependencies): Command =>
  asGroup(
    new Command('portal').description(
      'Serve one subgraph of a sandbox from your machine; the rest of the graph stays as it is',
    ),
    dependencies.context,
  )
    .addCommand(
      withExamples(
        withSandboxOptions(
          new Command('open')
            .description('Route a subgraph of the sandbox to a service on this machine until Ctrl-C')
            .argument('<subgraph>', 'Subgraph name in the sandbox')
            .option('--port <port>', 'Local port; the subgraph answers on http://localhost:<port>/graphql')
            .option('--url <url>', 'Full URL of the local subgraph'),
        ),
        ['wgc hub portal open reviews --port 4001', 'wgc hub portal open reviews --url http://localhost:4001/query'],
        'portal/open',
      ).action((subgraph: string, options: OpenOptions) => runOpen(subgraph, options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(
          new Command('close')
            .description('Close the portal of a subgraph; the sandbox serves it as before')
            .argument('<subgraph>', 'Subgraph name in the sandbox'),
        ),
        ['wgc hub portal close reviews', 'wgc hub portal close reviews --sandbox shop/checkout --json'],
        'portal/close',
      ).action((subgraph: string, options: SandboxOptions) => runClose(subgraph, options, dependencies)),
    )
    .addCommand(
      withExamples(
        withSandboxOptions(new Command('list').description("List the sandbox's portals, open ones first")),
        ['wgc hub portal list', 'wgc hub portal list --json'],
        'portal/list',
      ).action((options: SandboxOptions) => runList(options, dependencies)),
    );
