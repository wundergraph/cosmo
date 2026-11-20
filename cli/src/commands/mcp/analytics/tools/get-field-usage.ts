import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { graphInput, registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';
import { metricsWindow, retainedWindow, windowInput } from '../window.js';

export function registerGetFieldUsageTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_field_usage',
    {
      title: 'Get field usage',
      description:
        'Who uses a schema field, argument, input field or type: usage over time, and the clients, client versions and operations behind it, with first and last seen. Complete data. Usage counts selections times requests, so a field selected twice in one request counts twice.',
      inputSchema: {
        ...graphInput,
        ...windowInput,
        type: z.string().optional().describe('Parent type, e.g. "Query" or "User".'),
        field: z.string().optional().describe('Field, argument or input-field name. Omit for usage of the whole type.'),
        namedType: z.string().optional().describe('Usage of fields whose return type is this type.'),
        kind: z
          .enum(['field', 'argument', 'input'])
          .default('field')
          .describe('What `field` names: an output field, a field argument, or an input-object field.'),
      },
    },
    async (input, headers) => {
      const { window, warnings } = await retainedWindow(ctx, input, 'schema_usage');
      const resp = await ctx.client.getFieldUsage(
        {
          graphName: input.graph,
          namespace: input.namespace,
          typename: input.type,
          field: input.field,
          namedType: input.namedType,
          isArgument: input.kind === 'argument',
          isInput: input.kind === 'input',
          ...metricsWindow(window),
        },
        { headers },
      );
      const error = checkResponse(resp, 'Field usage');
      if (error) {
        return fail(error);
      }
      return ok(
        { requestSeries: resp.requestSeries, clients: resp.clients, meta: resp.meta },
        {
          graphs: [{ name: input.graph, namespace: input.namespace }],
          completeness: 'complete',
          window,
          now: ctx.now().toISOString(),
          warnings,
        },
      );
    },
  );
}
