import { Command } from 'commander';
import { asGroup as asSdkGroup, ok, withExamples as withSdkExamples } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, Output, PluginContext, Result } from '@wundergraph/wgc-plugin-sdk';
import { connectHub } from './hub.js';
import { projectDirectory, selectSandbox } from './link.js';
import type { SandboxSelection } from './link.js';
import type { HubDependencies } from './runtime.js';
import { resolveAudience } from './target.js';

const docsBase = 'https://cosmo-docs.wundergraph.com/cli/hub';

export interface SandboxOptions {
  sandbox?: string;
  config?: string;
  audience?: string;
  json?: boolean;
}

export const withSandboxOptions = (command: Command): Command =>
  command
    .option('--sandbox <schema/sandbox>', 'Target sandbox (default: WGC_SANDBOX, then .wgc/link.json)')
    .option('--config <path>', 'Path to wundergraph.yaml, next to which the link lives (default: the nearest one)')
    .option('--audience <audience>', 'OIDC audience Hub expects from CI (default: HUB_OIDC_AUDIENCE or hub)')
    .option('--json', 'Machine-readable output');

/** Leads the help with real examples and ends it with the docs page, e.g. `withExamples(cmd, [...], 'status')`. */
export const withExamples = (command: Command, examples: string[], docsPath: string): Command =>
  withSdkExamples(command, examples, `${docsBase}/${docsPath}`);

/** A command that only groups subcommands: bare it prints its help, an unknown subcommand exits 2. */
export const asGroup = (command: Command, context: PluginContext): Command => asSdkGroup(command, context, 'wgc hub');

export interface SandboxSession {
  hub: HubClient;
  selection: SandboxSelection;
  /** Where `.wgc/link.json` lives for this checkout. */
  directory: string;
}

/** Picks the sandbox a command acts on and connects to Hub with the right audience. */
export const openSandboxSession = async (
  dependencies: HubDependencies,
  options: SandboxOptions,
): Promise<Result<SandboxSession>> => {
  const cwd = dependencies.runtime.cwd();
  const directory = projectDirectory(cwd, options.config);
  const selection = await selectSandbox({ flag: options.sandbox, env: dependencies.runtime.env, directory });
  if (!selection.success) {
    return selection;
  }

  const audience = resolveAudience(options, dependencies.runtime.env);
  return ok({ hub: connectHub(dependencies.context, audience), selection: selection.data, directory });
};

/** Prints a long command's Hub page right under its title, so people and agents can follow it there. */
export const announceOperation = (output: Output, operation: { id: string; url: string }): void => {
  output.message(`  ${operation.url}\n`, { event: 'operation', id: operation.id, url: operation.url });
};
