import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { ToolArgument } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools } from '../common/contract.js';
import type { HubDependencies } from '../common/runtime.js';

interface ProposeOptions extends SandboxOptions {
  title?: string;
  bodyFile?: string;
  idempotencyKey?: string;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const runPropose = async (options: ProposeOptions, dependencies: HubDependencies): Promise<void> => {
  const { context, runtime } = dependencies;
  const output = context.output({ json: options.json });
  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const args: Record<string, ToolArgument> = {
    sandbox_id: selection.sandboxId,
    idempotency_key: options.idempotencyKey ?? runtime.newIdempotencyKey(),
  };
  if (options.title) {
    args.title = options.title;
  }
  if (options.bodyFile) {
    const bodyPath = path.resolve(runtime.cwd(), options.bodyFile);
    try {
      args.body = await readFile(bodyPath, 'utf8');
    } catch {
      output.fail({
        kind: 'usage',
        message: `No file at ${bodyPath}.`,
        remediation: 'Pass --body-file <path> to a readable Markdown file.',
        input: options.bodyFile,
      });
      return;
    }
  }

  const proposed = await hub.callTool(hubTools.createProposal, args, hubResults.createProposal);
  if (!proposed.success) {
    output.fail(toFailure(proposed));
    return;
  }

  const { proposal, created, changes } = proposed.data;
  const summary = `${plural(changes.total, 'schema change')}, ${changes.breaking} breaking`;
  output.result(
    proposed.data,
    () => {
      const headline = created
        ? `Created proposal #${proposal.number} from sandbox ${selection.sandboxId} (${summary})`
        : `Proposal #${proposal.number} from sandbox ${selection.sandboxId} is already open (${summary})`;
      return `${headline}\n${proposal.url}`;
    },
    { changed: created, url: proposal.url },
  );
};

export const proposeCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('propose')
        .description('Propose the schema changes of the sandbox to the graph')
        .option('--title <title>', 'Proposal title (default: Hub names it after the changes)')
        .option('--body-file <path>', 'Markdown file with the proposal description')
        .option('--idempotency-key <key>', 'Repeat safely: Hub returns the first proposal for the same key'),
    ),
    ['wgc hub propose --title "Add payments subgraph"', 'wgc hub propose --body-file proposal.md --json'],
    'propose',
  ).action((options: ProposeOptions) => runPropose(options, dependencies));
