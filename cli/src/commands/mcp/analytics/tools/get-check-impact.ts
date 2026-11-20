import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { absoluteWindow, windowInput } from '../window.js';

export function registerGetCheckImpactTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_check_impact',
    {
      title: 'Get check impact',
      description:
        "Schema checks already run against a graph, and the client traffic they found. With checkId: the check's summary (changes, breaking changes, traffic window) and the operations each breaking change affects, with first/last seen. Without it: recent checks (the last 7 days unless a window is given), with whether each was breaking and had client traffic. Reads existing check results; never runs a check.",
      inputSchema: {
        ...graphInput,
        ...windowInput,
        checkId: z.string().optional().describe('A check ID from the list of recent checks.'),
        limit: z.number().int().positive().default(10),
      },
    },
    async (input, headers) => {
      if (input.checkId) {
        const request = { checkId: input.checkId, graphName: input.graph, namespace: input.namespace };
        const [summary, operations] = await Promise.all([
          ctx.client.getCheckSummary(request, { headers }),
          ctx.client.getCheckOperations({ ...request, limit: input.limit, offset: 0 }, { headers }),
        ]);
        const error = checkResponse(summary, 'Check summary') ?? checkResponse(operations, 'Check operations');
        if (error) {
          return fail(error);
        }
        const { response: _summaryResponse, ...check } = summary;
        const { response: _operationsResponse, ...affected } = operations;
        return ok(
          { check, affected },
          {
            graphs: [{ name: input.graph, namespace: input.namespace }],
            completeness: 'complete',
            now: ctx.now().toISOString(),
            warnings: [],
          },
        );
      }

      const { start, end } = absoluteWindow(input, '7d', ctx.now());
      const resp = await ctx.client.getChecksByFederatedGraphName(
        {
          name: input.graph,
          namespace: input.namespace,
          limit: input.limit,
          offset: 0,
          startDate: start,
          endDate: end,
        },
        { headers },
      );
      const error = checkResponse(resp, 'Checks');
      if (error) {
        return fail(error);
      }
      return ok(
        { checks: resp.checks },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          window: { dateRange: { start, end } },
          now: ctx.now().toISOString(),
          warnings: [],
        },
      );
    },
  );
}
