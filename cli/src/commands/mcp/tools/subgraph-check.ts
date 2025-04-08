import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getBaseHeaders } from '../../../core/config.js';
import { z } from 'zod';
import { ToolContext } from './types.js';
import { SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export const registerSubgraphCheckTool = ({ server, opts }: ToolContext) => {
    server.tool(
        "subgraph-check",
        "Check if a subgraph schema change would be valid",
        {
            name: z.string().describe("The name of the subgraph"),
            namespace: z.string().optional().describe("The namespace of the subgraph"),
            schema: z.string().optional().describe("The new schema SDL to check"),
            delete: z.boolean().optional().describe("Run checks in case the subgraph should be deleted"),
            skipTrafficCheck: z.boolean().optional().describe("Skip checking for client traffic")
        },
        async (params) => {
            const schema = params.schema ? Buffer.from(params.schema) : Buffer.from('');

            const resp = await opts.client.platform.checkSubgraphSchema(
                {
                    subgraphName: params.name,
                    namespace: params.namespace,
                    schema: new Uint8Array(schema),
                    delete: params.delete,
                    skipTrafficCheck: params.skipTrafficCheck,
                },
                {
                    headers: getBaseHeaders(),
                },
            );

            // Format the check results in a readable way
            const formatResults = () => {
                const results: string[] = [];

                if (resp.compositionErrors?.length) {
                    results.push("Composition Errors:");
                    resp.compositionErrors.forEach(error => {
                        results.push(`- ${error.message}`);
                    });
                }

                if (resp.breakingChanges?.length) {
                    results.push("\nBreaking Changes:");
                    resp.breakingChanges.forEach((change: SchemaChange) => {
                        results.push(`- ${change.message} (${change.changeType})`);
                    });
                }

                if (resp.nonBreakingChanges?.length) {
                    results.push("\nNon-Breaking Changes:");
                    resp.nonBreakingChanges.forEach((change: SchemaChange) => {
                        results.push(`- ${change.message} (${change.changeType})`);
                    });
                }

                if (resp.compositionWarnings?.length) {
                    results.push("\nComposition Warnings:");
                    resp.compositionWarnings.forEach(warning => {
                        results.push(`- ${warning.message}`);
                    });
                }

                if (results.length === 0) {
                    results.push("No issues found - schema is valid!");
                }

                return results.join("\n");
            };

            return {
                content: [{ type: "text", text: formatResults() }]
            };
        }
    );
}; 