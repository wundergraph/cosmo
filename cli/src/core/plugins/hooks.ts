import { program } from 'commander';
import pc from 'picocolors';
import type {
  AfterHook,
  BeforeHook,
  CommandHooks,
  HookableCommand,
  HookableCommands,
  HookContribution,
  HookJson,
  PluginContext,
} from '@wundergraph/wgc-plugin-sdk';

/** One plugin's contribution to a command run. */
export interface PluginVerdict {
  plugin: string;
  contribution: HookContribution;
}

export interface HookOutcome {
  /** Whether any plugin failed the command. */
  failed: boolean;
  verdicts: PluginVerdict[];
}

interface Registered<H> {
  plugin: string;
  context: PluginContext;
  hook: H;
}

type HookTable = {
  [N in HookableCommand]: { before: Registered<BeforeHook<N>>[]; after: Registered<AfterHook<N>>[] };
};

const emptyTable = (): HookTable => ({
  'subgraph check': { before: [], after: [] },
  'subgraph publish': { before: [], after: [] },
  'subgraph create': { before: [], after: [] },
  'subgraph delete': { before: [], after: [] },
  'federated-graph create': { before: [], after: [] },
  'federated-graph delete': { before: [], after: [] },
});

const outcomeOf = (verdicts: PluginVerdict[]): HookOutcome => ({
  failed: verdicts.some((verdict) => verdict.contribution.verdict === 'failed'),
  verdicts,
});

/** Runs one hook; a hook that throws fails the command with its error. */
const runOne = async (
  plugin: string,
  run: () => Promise<HookContribution | undefined>,
): Promise<PluginVerdict | undefined> => {
  try {
    const contribution = await run();
    return contribution === undefined ? undefined : { plugin, contribution };
  } catch (error) {
    return { plugin, contribution: { verdict: 'failed', summary: `hook failed: ${(error as Error).message}` } };
  }
};

const collect = async (runs: Array<() => Promise<PluginVerdict | undefined>>): Promise<HookOutcome> => {
  const verdicts: PluginVerdict[] = [];
  for (const run of runs) {
    const verdict = await run();
    if (verdict !== undefined) {
      verdicts.push(verdict);
    }
  }
  return outcomeOf(verdicts);
};

export const createCommandHookRegistry = () => {
  let table = emptyTable();

  return {
    /** The `CommandHooks` a plugin's `hooks()` registers through, tagged with its name. */
    forPlugin(plugin: string, context: PluginContext): CommandHooks {
      return {
        before(command, hook) {
          table[command].before.push({ plugin, context, hook });
        },
        after(command, hook) {
          table[command].after.push({ plugin, context, hook });
        },
      };
    },

    async runBefore<N extends HookableCommand>(command: N, input: HookableCommands[N]['input']): Promise<HookOutcome> {
      const registered: Registered<BeforeHook<N>>[] = table[command].before;
      return await collect(
        registered.map(
          (entry) => () => runOne(entry.plugin, () => entry.hook({ command, input, context: entry.context })),
        ),
      );
    },

    async runAfter<N extends HookableCommand>(
      command: N,
      input: HookableCommands[N]['input'],
      result: HookableCommands[N]['result'],
    ): Promise<HookOutcome> {
      const registered: Registered<AfterHook<N>>[] = table[command].after;
      return await collect(
        registered.map(
          (entry) => () => runOne(entry.plugin, () => entry.hook({ command, input, result, context: entry.context })),
        ),
      );
    },

    clear(): void {
      table = emptyTable();
    },
  };
};

export type CommandHookRegistry = ReturnType<typeof createCommandHookRegistry>;

/** The hooks the plugins of this wgc run registered; core commands run them. */
export const commandHooks = createCommandHookRegistry();

const symbols: Record<HookContribution['verdict'], string> = {
  passed: pc.green('✔'),
  failed: pc.red('✖'),
  info: pc.cyan('ℹ'),
};

/** `✔ hub: sandbox pr-shop-12 is ready`, then its details and link, one plugin after another. */
export const renderVerdicts = (outcome: HookOutcome): string =>
  outcome.verdicts
    .flatMap(({ plugin, contribution }) => [
      `${symbols[contribution.verdict]} ${pc.bold(plugin)}: ${contribution.summary}`,
      ...(contribution.details ?? []).map((line) => `  ${line}`),
      ...(contribution.url === undefined ? [] : [`  ${contribution.url}`]),
    ])
    .join('\n');

/** The plugins' contributions for a command's JSON output, keyed by plugin. */
export const verdictsJson = (outcome: HookOutcome): { [plugin: string]: { [key: string]: HookJson } } =>
  Object.fromEntries(
    outcome.verdicts.map(({ plugin, contribution }) => [
      plugin,
      {
        verdict: contribution.verdict,
        summary: contribution.summary,
        details: contribution.details ?? [],
        url: contribution.url ?? null,
        data: contribution.data ?? {},
      },
    ]),
  );

/** `hub: collections failed; acme: ...` for the plugins that failed the command. */
export const failedSummary = (outcome: HookOutcome): string =>
  outcome.verdicts
    .filter((verdict) => verdict.contribution.verdict === 'failed')
    .map(({ plugin, contribution }) => `${plugin}: ${contribution.summary}`)
    .join('; ');

/** Runs the plugins' `before` hooks of a core command; one that fails stops the command with its reason. */
export const runBeforeHooks = async <N extends HookableCommand>(
  command: N,
  input: HookableCommands[N]['input'],
): Promise<void> => {
  const outcome = await commandHooks.runBefore(command, input);
  if (outcome.failed) {
    program.error(`${renderVerdicts(outcome)}\n${pc.red(`${command} stopped by ${failedSummary(outcome)}`)}`);
  }
  if (outcome.verdicts.length > 0) {
    console.log(renderVerdicts(outcome));
  }
};

/** Runs the plugins' `after` hooks of a core command, prints their verdicts and fails the run when one fails. */
export const runAfterHooks = async <N extends HookableCommand>(
  command: N,
  input: HookableCommands[N]['input'],
  result: HookableCommands[N]['result'],
): Promise<void> => {
  const outcome = await commandHooks.runAfter(command, input, result);
  if (outcome.verdicts.length > 0) {
    console.log(renderVerdicts(outcome));
  }
  if (outcome.failed) {
    console.error(pc.red(`${command} failed: ${failedSummary(outcome)}`));
    process.exitCode = 1;
  }
};
