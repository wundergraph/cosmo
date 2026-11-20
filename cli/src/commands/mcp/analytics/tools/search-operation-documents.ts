import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { OPERATORS, rowsToObjects, serverMeta, toTimeWindow, truncateValue } from '../query.js';

export function registerSearchOperationDocumentsTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'search_operation_documents',
    {
      title: 'Search operation documents',
      description:
        'Operations whose normalized document contains a text (a field, argument, alias or directive name), case-insensitive, among operations with traffic in your retention window. Documents are normalized: fragments are inlined and their names removed, and literal values become variables, so fragment names and literal values can’t be found.',
      inputSchema: {
        ...graphInput,
        contains: z.string().min(1).describe('Text to find, e.g. "deprecatedField" or "@include".'),
        range: z
          .string()
          .optional()
          .describe('Only operations with traffic in this window, e.g. "7d". Default: your whole retention.'),
        full: z.boolean().default(false).describe('Return documents over 2 KB in full.'),
        limit: z.number().int().positive().max(200).default(20),
      },
    },
    async (input, headers) => {
      const resp = await ctx.client.queryAnalytics(
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          dataset: 'operation_documents',
          dimensions: ['operationHash', 'operationName', 'operationType'],
          measures: ['document'],
          filters: [{ field: 'content', operator: OPERATORS.contains, values: [input.contains] }],
          window: input.range ? toTimeWindow({ range: input.range }) : undefined,
          orderBy: [{ field: 'operationName', desc: false }],
          limit: input.limit,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Document search');
      if (error) {
        return fail(error);
      }
      let truncated = false;
      const operations = rowsToObjects(resp.rows, resp.columns).map((row) => {
        const document = truncateValue(String(row.document ?? ''), input.full);
        truncated ||= document.truncated;
        return { ...row, document: document.value };
      });
      return ok(
        { operations },
        serverMeta(resp.meta, {
          now: ctx.now().toISOString(),
          warnings: truncated ? ['Some documents were truncated to 2 KB; repeat with full: true.'] : [],
        }),
      );
    },
  );
}
