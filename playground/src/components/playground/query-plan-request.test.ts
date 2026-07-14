import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildQueryPlanBody, buildQueryPlanHeaders } from './query-plan-request';

describe('query plan requests', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'playground:env' ? JSON.stringify({ '0': { TOKEN: 'resolved' } }) : null),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses effective embed headers and the complete selected operation request', () => {
    expect(
      buildQueryPlanHeaders('{"x-tab":"active"}', {
        transformHeaders: (headers) => ({
          ...headers,
          authorization: 'Bearer {{ TOKEN }}',
          'x-wg-trace': 'true',
        }),
      }),
    ).toEqual({
      'x-tab': 'active',
      authorization: 'Bearer resolved',
      'X-WG-Include-Query-Plan': 'true',
      'X-WG-Skip-Loader': 'true',
      'X-WG-DISABLE-TRACING': 'true',
    });
    expect(
      buildQueryPlanBody({
        query: 'query First { first } query Selected($enabled: Boolean!) { selected }',
        operationName: 'Selected',
        serializedVariables: '{"enabled":true}',
      }),
    ).toEqual({
      query: 'query First { first } query Selected($enabled: Boolean!) { selected }',
      operationName: 'Selected',
      variables: { enabled: true },
    });
  });

  it('rejects non-object variables', () => {
    expect(() => buildQueryPlanBody({ query: 'query Test { value }', serializedVariables: 'true' })).toThrow(
      'Variables must be a JSON object.',
    );
  });
});
