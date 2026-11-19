import { createOutput, errorMessage } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient } from '@wundergraph/wgc-plugin-sdk';
import { z } from 'zod';

const sandboxReference = z
  .string()
  .regex(/^[^\s/]+\/[^\s/]+$/, 'Expected <schema>/<sandbox>, e.g. products/add-reviews.');

const hubProposalTarget = z.object({
  kind: z.enum(['hub', 'cosmo', 'git']),
  status: z.enum(['open', 'done', 'closed', 'failed']),
  externalRef: z.string().nullish(),
  detail: z.string().nullish(),
});

/** What Hub's `propose` tool returns. */
export const hubProposalResult = z.object({
  proposalId: z.string().min(1),
  proposalUrl: z.string().url(),
  targets: z.array(hubProposalTarget),
});

export type HubProposalResult = z.infer<typeof hubProposalResult>;

const renderProposal = (proposal: HubProposalResult): string => {
  const lines = [`Hub proposal ${proposal.proposalId} created.`, `  Hub:   ${proposal.proposalUrl}`];
  for (const target of proposal.targets.filter((candidate) => candidate.kind !== 'hub')) {
    const reference = target.externalRef ?? 'no reference yet';
    const detail = target.detail ? `, ${target.detail}` : '';
    lines.push(`  ${target.kind === 'cosmo' ? 'Cosmo' : 'Git'}: ${reference} (${target.status}${detail})`);
  }
  return lines.join('\n');
};

/** Creates a Hub proposal from a sandbox; Hub's Cosmo target opens the Cosmo proposal and links both. */
export const createProposalFromHubSandbox = async ({
  hubSandbox,
  json,
  hubClient,
}: {
  hubSandbox: string;
  json: boolean;
  hubClient: HubClient;
}): Promise<void> => {
  const output = createOutput({ json });

  const reference = sandboxReference.safeParse(hubSandbox);
  if (!reference.success) {
    output.fail({
      message: 'The --hub-sandbox value is not a sandbox reference.',
      input: hubSandbox,
      fix: reference.error.issues[0].message,
    });
    return;
  }

  output.progress({ step: 'propose', subject: hubSandbox, message: 'Creating the Hub and Cosmo proposals' });
  const proposed = await hubClient.callTool(
    'propose',
    { sandbox: reference.data, targets: ['cosmo'] },
    hubProposalResult,
  );
  if (!proposed.success) {
    output.fail({ message: errorMessage(proposed), input: hubSandbox });
    return;
  }

  const cosmoTarget = proposed.data.targets.find((target) => target.kind === 'cosmo');
  if (!cosmoTarget) {
    output.fail({
      message: `Hub created ${proposed.data.proposalUrl} but did not report a Cosmo proposal.`,
      input: hubSandbox,
    });
    return;
  }
  if (cosmoTarget.status === 'failed') {
    output.fail({
      message: `Hub created ${proposed.data.proposalUrl} but the Cosmo proposal failed: ${cosmoTarget.detail ?? 'no detail'}`,
      input: hubSandbox,
      fix: 'Fix the reported problem in the sandbox, then propose again.',
    });
    return;
  }

  output.result(proposed.data, renderProposal);
};
