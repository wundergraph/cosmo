import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/playground/custom-scripts', () => ({
  attachPlaygroundAPI: vi.fn(),
  detachPlaygroundAPI: vi.fn(),
}));

import { buildQueryPlanBody, buildQueryPlanHeaders } from './query-plan-request';

describe('query plan requests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('includes the selected operation, variables, and feature-flag routing identity', () => {
    localStorage.setItem('playground:env', JSON.stringify({ graph: { TOKEN: 'resolved' } }));

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
    expect(
      buildQueryPlanHeaders({
        serializedHeaders: '{"authorization":"Bearer {{ TOKEN }}","x-wg-trace":"true","x-wg-token":"untrusted"}',
        graphId: 'graph',
        graphRequestToken: 'managed-token',
        featureFlagName: 'canary',
      }),
    ).toEqual({
      authorization: 'Bearer resolved',
      'X-WG-Token': 'managed-token',
      'X-WG-Include-Query-Plan': 'true',
      'X-WG-Skip-Loader': 'true',
      'X-WG-DISABLE-TRACING': 'true',
      'X-Feature-Flag': 'canary',
    });
  });

  it('rejects non-object variables', () => {
    expect(() => buildQueryPlanBody({ query: 'query Test { value }', serializedVariables: '[true]' })).toThrow(
      'Variables must be a JSON object.',
    );
  });
});
