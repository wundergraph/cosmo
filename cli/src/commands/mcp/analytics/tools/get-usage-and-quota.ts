import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { z } from 'zod';
import type { AnalyticsToolContext } from '../context.js';
import { registerAnalyticsTool } from '../context.js';
import { checkResponse, fail, ok } from '../envelope.js';

/**
 * End-of-month projection of the current month's requests, assuming the rate so far continues.
 * Undefined before any of the month has passed.
 */
export function forecastMonth(currentMonthCount: number, now: Date): number | undefined {
  const elapsedDays = now.getUTCDate() - 1 + now.getUTCHours() / 24;
  if (elapsedDays <= 0) {
    return undefined;
  }
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.round((currentMonthCount / elapsedDays) * daysInMonth);
}

export function registerGetUsageAndQuotaTool(ctx: AnalyticsToolContext) {
  registerAnalyticsTool(
    ctx,
    'get_usage_and_quota',
    {
      title: 'Get usage and quota',
      description:
        "The organization's request usage: this calendar month so far, an end-of-month forecast, the plan's monthly limit and the share used, and a per-month, per-graph history (requests of deleted graphs are one remainder entry, so graphs add up to the total). Organization admins only.",
      inputSchema: {
        months: z
          .number()
          .int()
          .min(1)
          .max(3)
          .default(1)
          .describe('Calendar months of history, including the current one (1-3).'),
      },
    },
    async (input, headers) => {
      const [usage, capabilities] = await Promise.all([
        ctx.client.getOrganizationRequestsCount({ months: input.months }, { headers }),
        ctx.client.getAnalyticsCapabilities({}, { headers }),
      ]);
      if (usage.response?.code === EnumStatusCode.ERROR_NOT_AUTHORIZED) {
        return fail('Only organization admins can see request usage.');
      }
      const error = checkResponse(usage, 'Request usage');
      if (error) {
        return fail(error);
      }

      const currentMonth = Number(usage.count);
      const limit = capabilities.monthlyRequestLimit;
      return ok(
        {
          currentMonth: usage.count,
          forecast: forecastMonth(currentMonth, ctx.now()),
          monthlyLimit: limit,
          percentOfLimit: limit ? Math.round((currentMonth / Number(limit)) * 1000) / 10 : undefined,
          history: usage.history,
        },
        { completeness: 'complete', now: ctx.now().toISOString(), warnings: [] },
      );
    },
  );
}
