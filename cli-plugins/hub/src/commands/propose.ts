import { Command } from 'commander';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import { openSandboxSession, withExamples, withSandboxOptions } from '../common/command.js';
import type { SandboxOptions } from '../common/command.js';
import { hubResults, hubTools, proposeTargets } from '../common/contract.js';
import type { ProposalTarget, ProposeTarget } from '../common/contract.js';
import type { HubDependencies } from '../common/runtime.js';

interface ProposeOptions extends SandboxOptions {
  target?: string[];
  description?: string;
}

interface Proposed {
  sandbox: string;
  proposalId: string;
  proposalUrl: string;
  targets: ProposalTarget[];
}

/** `  git    open    https://github.com/acme/shop/pull/12  wrote 1 schema file`: one line per target. */
const renderTarget = (target: ProposalTarget): string =>
  `  ${target.kind.padEnd(7)}${target.status.padEnd(8)}${[target.externalRef, target.detail]
    .filter((part) => part !== null)
    .join('  ')}`.trimEnd();

const renderProposed = (data: Proposed): string =>
  [
    `Proposed sandbox ${data.sandbox}`,
    ...data.targets.map((target) => renderTarget(target)),
    `  Review it in Hub: ${data.proposalUrl}`,
  ].join('\n');

const knownTargets = new Set<string>(proposeTargets);

const isProposeTarget = (target: string): target is ProposeTarget => knownTargets.has(target);

const runPropose = async (options: ProposeOptions, dependencies: HubDependencies): Promise<void> => {
  const output = dependencies.context.output({ json: options.json });
  const unknownTarget = options.target?.find((target) => !isProposeTarget(target));
  if (unknownTarget !== undefined) {
    output.fail({
      kind: 'usage',
      message: `--target ${unknownTarget} is not a place to propose.`,
      remediation: `Pass one or both of: ${proposeTargets.join(', ')}.`,
      input: '--target',
    });
    return;
  }

  const session = await openSandboxSession(dependencies, options);
  if (!session.success) {
    output.fail(toFailure(session));
    return;
  }

  const { hub, selection } = session.data;
  const proposed = await hub.callTool(
    hubTools.propose,
    {
      sandbox: selection.sandbox,
      ...(options.target === undefined ? {} : { targets: [...new Set(options.target)] }),
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    hubResults.propose,
  );
  if (!proposed.success) {
    output.fail(toFailure(proposed));
    return;
  }

  const answer = proposed.data;
  if (answer.status === 'needs_approval') {
    output.fail({
      kind: 'confirmation',
      code: 'CONFIRMATION_REQUIRED',
      message: `Waiting on approval in Hub: ${answer.reason}`,
      remediation: `Approve it in Hub:\n${answer.dashboardUrl}`,
      next: [`wgc hub operation watch ${answer.operationId}`],
      url: answer.dashboardUrl,
      data: { operation: { id: answer.operationId, status: answer.status } },
    });
    return;
  }

  const data: Proposed = {
    sandbox: selection.sandbox,
    proposalId: answer.proposalId,
    proposalUrl: answer.proposalUrl,
    targets: answer.targets,
  };
  const failed = data.targets.filter((target) => target.status === 'failed');
  if (failed.length > 0) {
    output.fail(
      {
        code: 'PROPOSE_TARGET_FAILED',
        message: `${failed.map((target) => target.kind).join(', ')} failed: ${failed
          .map((target) => target.detail ?? 'no reason given')
          .join('; ')}`,
        url: data.proposalUrl,
        data,
      },
      renderProposed,
    );
    return;
  }

  output.result(data, renderProposed, {
    url: data.proposalUrl,
    next: [{ command: 'wgc hub open proposal', description: 'review it in Hub' }],
  });
};

export const proposeCommand = (dependencies: HubDependencies): Command =>
  withExamples(
    withSandboxOptions(
      new Command('propose')
        .description(
          'Propose the committed schema changes of the sandbox: open a Cosmo proposal, write them into pull requests or ' +
            'both. Exits 1 when a target fails.',
        )
        .option(
          '--target <target...>',
          `Where to propose: ${proposeTargets.join(', ')}; repeat for both (default: every target the schema has available)`,
        )
        .option('--description <text>', 'What the change is for; reviewers read it'),
    ),
    [
      'wgc hub propose',
      'wgc hub propose --target cosmo --target git --description "Add product reviews"',
      'wgc hub propose --sandbox shop/shop-nithin --json',
    ],
    'propose',
  ).action((options: ProposeOptions) => runPropose(options, dependencies));
