import { buildUrl } from '../lib/build-url';

import { expect, test } from 'vitest';

test('that a template without parameters is rendered correctly', () => {
  expect(buildUrl('/test')).toBe('http://localhost:3000/test');
});

test('that a template with parameters is rendered correctly and extra parameters are added to query', () => {
  const url = buildUrl('/:slug/:namespace/graph/:name', {
    slug: 'org',
    namespace: 'default',
    name: 'feat/graph',
    arg1: 'abc123',
  });

  expect(url).toBe('http://localhost:3000/org/default/graph/feat%2Fgraph?arg1=abc123');
});

test('that all segments are encoded correctly', () => {
  const url = buildUrl('/:slug/:namespace/graph with space/:name', {
    slug: 'org',
    namespace: 'default',
    name: 'feat/graph',
  });

  expect(url).toBe('http://localhost:3000/org/default/graph%20with%20space/feat%2Fgraph');
});

test('that segments with missing parameters are skipped', () => {
  // @ts-ignore: TypeScript errors as is missing a required parameter
  const url = buildUrl('/:slug/:namespace/:name', {
    namespace: 'default',
  });

  expect(url).toBe('http://localhost:3000/default');
});
