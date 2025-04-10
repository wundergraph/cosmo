import { z } from 'zod';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { program } from 'commander';
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { ToolContext } from './types.js';

export const SupergraphChangelogInputSchema = z.object({
  name: z.string().describe('The name of the federated graph.'),
  namespace: z.string().optional().describe('The namespace of the federated graph.'),
  limit: z.number().int().positive().default(50).describe('The maximum number of changelog entries to return.'),
  offset: z.number().int().nonnegative().default(0).describe('The offset for pagination.'),
  daysOfHistory: z.number().int().positive().default(30).describe('The number of days of history to fetch.'),
});

export type SupergraphChangelogInput = z.infer<typeof SupergraphChangelogInputSchema>;

export default async function main(opts: BaseCommandOptions, input: SupergraphChangelogInput) {
  const resp = await opts.client.platform.getFederatedGraphChangelog(
    {
      name: input.name,
      namespace: input.namespace,
      pagination: {
        limit: input.limit,
        offset: input.offset,
      },
      dateRange: {
        start: formatISO(startOfDay(subDays(new Date(), input.daysOfHistory)), { representation: 'date' }),
        end: formatISO(endOfDay(new Date()), { representation: 'date' }),
      },
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    program.error(`Could not fetch changelog: ${resp.response?.details || 'Unknown error'}`);
  }

  return resp.federatedGraphChangelogOutput;
}

export function registerSupergraphChangelogTool({ server, opts }: ToolContext) {
  server.tool(
    'supergraph_changelog',
    'Fetch the changelog for a federated graph / Supergraph.',
    SupergraphChangelogInputSchema.shape,
    async (toolInput: SupergraphChangelogInput) => {
      const mainOutput = await main(opts, toolInput);
      // The .tool method expects a specific return format
      return { content: [{ type: 'text', text: JSON.stringify(mainOutput, null, 2) }] };
    },
  );
}
