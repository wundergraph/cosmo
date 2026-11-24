import type { PluginContext } from './plugin.js';

/** The core wgc commands a plugin can hook, with the input each one runs on and the result it reaches. */
export interface HookableCommands {
  'subgraph check': {
    input: { subgraph: string; namespace: string; schemaPath: string | undefined; delete: boolean };
    /** Cosmo's verdict: `checkUrl` is the check's Studio page, `problems` each breaking change, composition or lint error. */
    result: { passed: boolean; checkUrl: string | undefined; problems: string[] };
  };
  'subgraph publish': {
    input: { subgraph: string; namespace: string; schemaPath: string; routingUrl: string | undefined };
    /** `published` is false when Cosmo refused the schema; composition errors still publish it. */
    result: { published: boolean; changed: boolean; compositionErrors: string[] };
  };
  'subgraph create': {
    input: { subgraph: string; namespace: string; routingUrl: string | undefined };
    result: { created: boolean };
  };
  'subgraph delete': {
    input: { subgraph: string; namespace: string };
    result: { deleted: boolean };
  };
  'federated-graph create': {
    input: { graph: string; namespace: string; routingUrl: string; labelMatchers: string[] };
    result: { created: boolean };
  };
  'federated-graph delete': {
    input: { graph: string; namespace: string };
    result: { deleted: boolean };
  };
}

export type HookableCommand = keyof HookableCommands;

export const hookableCommands: readonly HookableCommand[] = [
  'subgraph check',
  'subgraph publish',
  'subgraph create',
  'subgraph delete',
  'federated-graph create',
  'federated-graph delete',
];

export type HookJson = string | number | boolean | null | HookJson[] | { [key: string]: HookJson };

/**
 * What a hook adds to its command. `failed` fails the command (a `before` hook stops it from running); `passed` and
 * `info` keep it going. `summary` is one line under the plugin's name; `data` lands under `plugins.<name>` in JSON.
 */
export interface HookContribution {
  verdict: 'passed' | 'failed' | 'info';
  summary: string;
  details?: string[];
  url?: string;
  data?: { [key: string]: HookJson };
}

export interface BeforeHookEvent<N extends HookableCommand> {
  command: N;
  input: HookableCommands[N]['input'];
  context: PluginContext;
}

export interface AfterHookEvent<N extends HookableCommand> extends BeforeHookEvent<N> {
  result: HookableCommands[N]['result'];
}

/** Resolves to undefined when the hook has nothing to add, e.g. outside the setting it serves. */
export type BeforeHook<N extends HookableCommand> = (
  event: BeforeHookEvent<N>,
) => Promise<HookContribution | undefined>;

export type AfterHook<N extends HookableCommand> = (event: AfterHookEvent<N>) => Promise<HookContribution | undefined>;

export interface CommandHooks {
  /** Runs before the command does anything; a `failed` contribution stops it. */
  before<N extends HookableCommand>(command: N, hook: BeforeHook<N>): void;
  /** Runs once the command has its result, success or not; its contribution joins the command's verdict. */
  after<N extends HookableCommand>(command: N, hook: AfterHook<N>): void;
}
