import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { checkResponse } from '../../../src/commands/mcp/analytics/envelope.js';

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
