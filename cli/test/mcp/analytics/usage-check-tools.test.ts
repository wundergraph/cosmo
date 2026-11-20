import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  forecastMonth,
  registerGetUsageAndQuotaTool,
} from '../../../src/commands/mcp/analytics/tools/get-usage-and-quota.js';
import { registerGetCheckImpactTool } from '../../../src/commands/mcp/analytics/tools/get-check-impact.js';
import { fakeContext } from './fake-context.js';

const okResponse = { response: { code: EnumStatusCode.OK } };

describe('forecastMonth', () => {
  test('projects the month from the elapsed share of it', () => {
    expect(forecastMonth(140, new Date('2026-10-15T00:00:00Z'))).toBe(310);
  });

  test('has no forecast before any of the month has passed', () => {
    expect(forecastMonth(0, new Date('2026-10-01T00:00:00Z'))).toBe(undefined);
  });
});

describe('get_usage_and_quota', () => {
  test('returns the current month, the forecast and the share of the plan limit', async () => {
    const { ctx, tools } = fakeContext(
      {
        getOrganizationRequestsCount: (req) => ({
          ...okResponse,
          count: BigInt(140),
          history: [{ month: '2026-10', count: BigInt(140), graphs: [] }].slice(0, req.months ?? 1),
        }),
        getAnalyticsCapabilities: () => ({ ...okResponse, monthlyRequestLimit: BigInt(1000) }),
      },
      new Date('2026-10-15T00:00:00Z'),
    );
    registerGetUsageAndQuotaTool(ctx);

    const result = await tools.get('get_usage_and_quota')!.handler({ months: 1 });
    const data = (result.structuredContent as any).data;

    expect(data.currentMonth).toBe('140');
    expect(data.forecast).toBe(310);
    expect(data.monthlyLimit).toBe('1000');
    expect(data.percentOfLimit).toBe(14);
    expect(data.history).toEqual([{ month: '2026-10', count: '140', graphs: [] }]);
  });

  test('explains that usage is for organization admins', async () => {
    const { ctx, tools } = fakeContext({
      getOrganizationRequestsCount: () => ({ response: { code: EnumStatusCode.ERROR_NOT_AUTHORIZED } }),
      getAnalyticsCapabilities: () => okResponse,
    });
    registerGetUsageAndQuotaTool(ctx);

    const result = await tools.get('get_usage_and_quota')!.handler({});

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Only organization admins can see request usage.' }],
    });
  });
});

describe('get_check_impact', () => {
  test('reads one check and its affected operations', async () => {
    const calls: string[] = [];
    const { ctx, tools } = fakeContext({
      getCheckSummary: () => {
        calls.push('summary');
        return okResponse;
      },
      getCheckOperations: () => {
        calls.push('operations');
        return { ...okResponse, operations: [] };
      },
      getChecksByFederatedGraphName: () => {
        calls.push('list');
        return { ...okResponse, checks: [] };
      },
    });
    registerGetCheckImpactTool(ctx);

    await tools.get('get_check_impact')!.handler({ graph: 'shop', namespace: 'default', checkId: 'c1' });

    expect(calls.sort()).toEqual(['operations', 'summary']);
  });

  test('lists recent checks when no check is given', async () => {
    const calls: string[] = [];
    const { ctx, tools } = fakeContext({
      getChecksByFederatedGraphName: (req) => {
        calls.push(`list:${req.limit}`);
        return { ...okResponse, checks: [] };
      },
    });
    registerGetCheckImpactTool(ctx);

    await tools.get('get_check_impact')!.handler({ graph: 'shop', namespace: 'default' });

    expect(calls).toEqual(['list:10']);
  });

  test('lists checks in an explicit window', async () => {
    let window: { startDate: string; endDate: string } | undefined;
    const { ctx, tools } = fakeContext({
      getChecksByFederatedGraphName: (req) => {
        window = { startDate: req.startDate, endDate: req.endDate };
        return { ...okResponse, checks: [] };
      },
    });
    registerGetCheckImpactTool(ctx);

    const result = await tools.get('get_check_impact')!.handler({
      graph: 'shop',
      namespace: 'default',
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-08T00:00:00Z',
    });

    expect(result.isError).toBe(undefined);
    expect(window).toEqual({ startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-08T00:00:00Z' });
  });
});
