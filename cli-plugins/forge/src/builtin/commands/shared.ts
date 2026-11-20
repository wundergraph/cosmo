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
}

export interface CommonOptions {
  json?: boolean;
  dir?: string;
}

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
