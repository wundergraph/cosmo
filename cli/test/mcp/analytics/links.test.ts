import { describe, expect, test } from 'vitest';
import { studioUrl } from '../../../src/commands/mcp/analytics/links.js';

describe('studioUrl', () => {
  test('links a graph page with encoded segments and query parameters', () => {
    expect(
      studioUrl('https://cosmo.wundergraph.com', 'acme', 'default', 'my graph', 'traces', { traceID: 'abc' }),
    ).toBe('https://cosmo.wundergraph.com/acme/default/graph/my%20graph/analytics/traces?traceID=abc');
  });

  test('links the metrics page without parameters', () => {
    expect(studioUrl('https://cosmo.wundergraph.com/', 'acme', 'prod', 'shop', 'analytics')).toBe(
      'https://cosmo.wundergraph.com/acme/prod/graph/shop/analytics',
    );
  });

  test('links the operations page', () => {
    expect(studioUrl('https://cosmo.wundergraph.com', 'acme', 'prod', 'shop', 'operations')).toBe(
      'https://cosmo.wundergraph.com/acme/prod/graph/shop/operations',
    );
  });
});
