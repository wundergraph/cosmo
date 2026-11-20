import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ANALYTICS_READ_RPCS, createReadOnlyAnalyticsClient } from '../../../src/commands/mcp/analytics/client.js';
import { parseWindow } from '../../../src/commands/mcp/analytics/window.js';
import { checkResponse } from '../../../src/commands/mcp/analytics/envelope.js';

const analyticsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../src/commands/mcp/analytics');

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

describe('analytics read-only client', () => {
  test('exposes exactly the allow-listed read RPCs', () => {
    const platform = createClient(
      PlatformService,
      createRouterTransport(() => {}),
    );

    const client = createReadOnlyAnalyticsClient(platform);

    expect(Object.keys(client).sort()).toEqual([...ANALYTICS_READ_RPCS].sort());
  });

  test('no analytics file reaches the full platform client', () => {
    const offenders = filesUnder(analyticsDir).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('.platform.') || source.includes('opts.client');
    });

    expect(offenders).toEqual([]);
  });
});

describe('parseWindow', () => {
  test('turns a day range into hours', () => {
    expect(parseWindow({ range: '7d' })).toEqual({ range: 168 });
  });

  test('turns an hour range into hours', () => {
    expect(parseWindow({ range: '12h' })).toEqual({ range: 12 });
  });

  test('passes an explicit window through as a date range', () => {
    expect(parseWindow({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })).toEqual({
      dateRange: { start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' },
    });
  });

  test('defaults to the last 24 hours', () => {
    expect(parseWindow({})).toEqual({ range: 24 });
  });

  test('rejects mixing range and from/to', () => {
    expect(() => parseWindow({ range: '7d', from: '2026-10-01T00:00:00Z' })).toThrow(
      new Error('Use either range or from/to.'),
    );
  });

  test('rejects a malformed range', () => {
    expect(() => parseWindow({ range: 'week' })).toThrow(new Error('range must look like 24h or 7d.'));
  });
});

describe('checkResponse', () => {
  test('returns nothing for OK', () => {
    expect(checkResponse({ response: { code: EnumStatusCode.OK } }, 'Graph metrics')).toBe(undefined);
  });

  test('hides whether a graph is missing or forbidden', () => {
    expect(checkResponse({ response: { code: EnumStatusCode.ERR_NOT_FOUND } }, 'Graph metrics')).toBe(
      'Graph not found or you have no access.',
    );
    expect(checkResponse({ response: { code: EnumStatusCode.ERROR_NOT_AUTHORIZED } }, 'Graph metrics')).toBe(
      'Graph not found or you have no access.',
    );
  });

  test('passes the rate-limit hint through', () => {
    expect(
      checkResponse(
        { response: { code: EnumStatusCode.ERR_RATE_LIMITED, details: 'Rate limited, retry in 12s' } },
        'Graph metrics',
      ),
    ).toBe('Rate limited, retry in 12s');
  });

  test('explains disabled analytics', () => {
    expect(checkResponse({ response: { code: EnumStatusCode.ERR_ANALYTICS_DISABLED } }, 'Graph metrics')).toBe(
      'Analytics is not enabled on this Cosmo instance.',
    );
  });

  test('names the failing call for other errors', () => {
    expect(checkResponse({ response: { code: EnumStatusCode.ERR, details: 'boom' } }, 'Graph metrics')).toBe(
      'Graph metrics failed: boom',
    );
  });
});
