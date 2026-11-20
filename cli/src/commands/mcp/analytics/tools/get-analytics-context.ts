import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { ok } from '../envelope.js';

/** What get_analytics_context and the cosmo://analytics/context resource return, read fresh. */
export async function readAnalyticsContext(ctx: AnalyticsToolContext) {
  const { response: _response, ...capabilities } = await ctx.getCapabilities({ fresh: true });
  return { ...capabilities, organizationSlug: await ctx.getOrgSlug(), authMode: ctx.auth.mode };
}

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
    async () => {
      const context = await readAnalyticsContext(ctx);
      return ok(context, { completeness: 'complete', now: context.now, warnings: context.warnings });
    },
  );
}
