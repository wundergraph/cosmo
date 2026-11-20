import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';

export function registerGetAnalyticsContextTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_analytics_context',
    {
      title: 'Get analytics context',
      description:
        'Call this first. Returns the organization, how you are authenticated, the retention of each kind of analytics data (how many days back you can query), the trace sampling ceiling, the monthly request limit (admins only) and the server time.',
      inputSchema: {},
    },
    async (_input, headers) => {
      const resp = await ctx.client.getAnalyticsCapabilities({}, { headers });
      const error = checkResponse(resp, 'Analytics context');
      if (error) {
        return fail(error);
      }
      const { response, ...capabilities } = resp;
      return ok(
        { ...capabilities, organizationSlug: await ctx.getOrgSlug(), authMode: ctx.auth.mode },
        { completeness: 'complete', now: resp.now, warnings: resp.warnings },
      );
    },
  );
}
