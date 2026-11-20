import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { OPERATORS, rowsToObjects, serverMeta } from '../query-rpc.js';
import { queryWindow, windowInput } from '../window.js';

const BY = {
  message: { dataset: 'requests', dimensions: ['statusMessage'] },
  status: { dataset: 'requests', dimensions: ['httpStatusCode'] },
  client: { dataset: 'requests', dimensions: ['clientName', 'clientVersion'] },
  operation: { dataset: 'requests', dimensions: ['operationName'] },
  subgraph: { dataset: 'spans', dimensions: ['subgraphName', 'statusMessage'] },
} as const;

export function registerGetErrorBreakdownTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_error_breakdown',
    {
      title: 'Get error breakdown',
      description:
        'What is failing and why. complete: exact error counts and rates per operation and client from the complete metrics. sampled: the failing sampled requests grouped by error message (default), HTTP status, client or operation — or, with by "subgraph", failed subgraph fetches by subgraph and message — each with an example trace to open with get_trace (which also shows downstream error codes).',
      inputSchema: {
        ...graphInput,
        ...windowInput,
        by: z.enum(['message', 'status', 'client', 'operation', 'subgraph']).default('message'),
        operationName: z.string().optional(),
        clientName: z.string().optional(),
        limit: z.number().int().positive().max(200).default(20),
      },
    },
    async (input, headers) => {
      const graphs = [{ name: input.graph, namespace: input.namespace }];
      const window = queryWindow(input);
      const narrow = [
        ...(input.operationName
          ? [{ field: 'operationName', operator: OPERATORS.eq, values: [input.operationName] }]
          : []),
        ...(input.clientName ? [{ field: 'clientName', operator: OPERATORS.eq, values: [input.clientName] }] : []),
      ];
      const sampled = BY[input.by];
      const [complete, examples] = await Promise.all([
        ctx.client.queryAnalytics(
          {
            graphs,
            dataset: 'operation_metrics',
            dimensions: ['operationName', 'clientName'],
            measures: ['errors', 'errorRate', 'clientErrors', 'requests'],
            filters: narrow,
            having: [{ measure: 'errors', operator: OPERATORS.gt, value: 0 }],
            orderBy: [{ field: 'errors', desc: true }],
            window,
            limit: input.limit,
          },
          { headers },
        ),
        ctx.client.queryAnalytics(
          {
            graphs,
            dataset: sampled.dataset,
            dimensions: [...sampled.dimensions],
            measures: ['count', 'exampleTraceId'],
            filters: [
              ...narrow,
              { field: 'hasError', operator: OPERATORS.eq, values: ['true'] },
              ...(input.by === 'subgraph'
                ? [{ field: 'spanName', operator: OPERATORS.eq, values: ['Engine - Fetch'] }]
                : []),
            ],
            orderBy: [{ field: 'count', desc: true }],
            window,
            limit: input.limit,
          },
          { headers },
        ),
      ]);
      const error = checkResponse(complete, 'Error counts') ?? checkResponse(examples, 'Error examples');
      if (error) {
        return fail(error);
      }
      return ok(
        {
          complete: rowsToObjects(complete.rows, complete.columns),
          sampled: rowsToObjects(examples.rows, examples.columns),
        },
        serverMeta(complete.meta, {
          now: ctx.now().toISOString(),
          warnings: [
            '"complete" counts every request; "sampled" groups sampled failing requests (examples and messages, not totals).',
            ...(examples.meta?.observedSamplingRatio === undefined
              ? []
              : [`Observed sampling ratio for the sampled part: ${examples.meta.observedSamplingRatio}.`]),
          ],
        }),
      );
    },
  );
}
