import { z } from 'zod';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { ToolContext } from './types.js';

export const SupergraphChangelogInputSchema = z.object({
    name: z.string().describe('The name of the federated graph.'),
    namespace: z.string().optional().describe('The namespace of the federated graph.'),
    limit: z.number().int().positive().default(50).describe('The maximum number of changelog entries to return.'),
    offset: z.number().int().nonnegative().default(0).describe('The offset for pagination.'),
    startDate: z.string().optional().describe('The start date for the date range filter (ISO 8601 format).'),
    endDate: z.string().optional().describe('The end date for the date range filter (ISO 8601 format).'),
});

export type SupergraphChangelogInput = z.infer<typeof SupergraphChangelogInputSchema>;

export default async function main(opts: BaseCommandOptions, input: SupergraphChangelogInput) {
    const client = opts.client;

    const resp = await client.platform.getFederatedGraphChangelog(
        {
            name: input.name,
            namespace: input.namespace,
            pagination: {
                limit: input.limit,
                offset: input.offset,
            },
            // Convert dates only if provided
            dateRange: input.startDate && input.endDate ? {
                start: input.startDate,
                end: input.endDate,
            } : undefined,
        },
        {
            headers: getBaseHeaders(),
        },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
        program.error(`Could not fetch changelog: ${resp.response?.details || 'Unknown error'}`);
    }

    console.log(JSON.stringify(resp.federatedGraphChangelogOutput, null, 2));
    console.log(`
Has next page: ${resp.hasNextPage}`);

    return resp.federatedGraphChangelogOutput;
}

export function registerSupergraphChangelogTool({ server, opts }: ToolContext) {
    server.tool(
        'mcp_cosmo_supergraph_changelog',
        'Fetch the changelog for a federated graph / Supergraph.',
        SupergraphChangelogInputSchema.shape,
        async (toolInput: SupergraphChangelogInput) => {
            const mainOutput = await main(opts, toolInput);
            // The .tool method expects a specific return format
            return { content: [{ type: "text", text: JSON.stringify(mainOutput, null, 2) }] };
        },
    );
} 