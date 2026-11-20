import path from 'node:path';
import type { PluginContext } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import type { Lock } from '../lock.js';
import { describeRouterSource } from '../manifest.js';
import type { System } from '../system.js';

export interface ForgeDependencies {
  system: System;
  context: PluginContext;
  /** The directory the command was run from. */
  cwd: () => string;
  /** Per-user settings, such as the release channel. */
  settingsFile: string;
}

export interface CommonOptions {
  json?: boolean;
  dir?: string;
}

export type Acceptance = 'accepted' | 'declined' | 'needs-yes';

/** `--yes` accepts a reviewed change; otherwise only a person at a terminal without `--json` is asked. */
export const askToAccept = async (
  context: PluginContext,
  options: { yes?: boolean; json?: boolean },
  question: string,
): Promise<Acceptance> => {
  if (options.yes === true) {
    return 'accepted';
  }

  if (!context.prompts.canPrompt || options.json === true) {
    return 'needs-yes';
  }

  const accepted = await context.prompts.confirm(question, false);
  return accepted ? 'accepted' : 'declined';
};

export const withCommonOptions = (command: Command): Command =>
  command
    .option('--dir <path>', 'The Forge workspace directory. Defaults to the current directory.')
    .option('--json', 'Print the result as JSON and progress as NDJSON events on stderr.');

export const workspaceOf = (dependencies: ForgeDependencies, options: CommonOptions): string =>
  path.resolve(dependencies.cwd(), options.dir ?? '.');

export const routerSummary = (lock: Lock) => ({
  source: describeRouterSource(lock.router.source),
  version: lock.router.version,
  commit: lock.router.commit,
});

export const moduleSummaries = (lock: Lock) =>
  lock.modules.map((module) => ({
    package: module.package,
    module: module.module,
    version: module.version,
    ...(module.commit === undefined ? {} : { commit: module.commit }),
  }));
