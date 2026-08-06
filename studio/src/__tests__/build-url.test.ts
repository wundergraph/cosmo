import { buildUrl } from '../lib/build-url';

import { expect, test } from 'vitest';

test('that absolute template is rendered correctly', () => {
  const url = buildUrl('https://example.com/:slug', { slug: 'test' });
  expect(url).toBe('https://example.com/test');
});

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
  // @ts-ignore: TypeScript errors as is missing a required parameter (slug and name in this case)
  const url = buildUrl('/:slug/:namespace/:name', {
    namespace: 'default',
  });

  expect(url).toBe('http://localhost:3000/default');
});

test('that trailing slash is kept', () => {
  const url = buildUrl('/:slug/checks/', { slug: 'test' });

  expect(url).toBe('http://localhost:3000/test/checks/');
});

test('that parameters with empty, null and undefined are not added to the final url', () => {
  const url = buildUrl('/:a/:b/:c/:d/:e/test', {
    a: 'default',
    b: 0,
    c: '',
    d: null,
    e: undefined,
  });

  expect(url).toBe('http://localhost:3000/default/0/test');
});

test('that query parameters are not removed', () => {
  const url = buildUrl('/:slug?tag=test', {
    slug: 'default',
    filter: null,
    range: '1..22',
  });

  expect(url).toBe('http://localhost:3000/default?tag=test&range=1..22');
});

test('that query parameters are overwriten', () => {
  const url = buildUrl('/:slug?tag=test', {
    slug: 'default',
    tag: 'test',
    range: '1..22',
  });

  expect(url).toBe('http://localhost:3000/default?tag=test&range=1..22');
});

test('that query parameters are added in the same order as they appear', () => {
  const url = buildUrl('/test', {
    a: 'a',
    c: 'c',
    b: 'b',
  });

  expect(url).toBe('http://localhost:3000/test?a=a&c=c&b=b');
});

test('that query parameters are encoded', () => {
  const url = buildUrl('/test', { filter: 'graph test/path' });
  expect(url).toBe('http://localhost:3000/test?filter=graph+test%2Fpath');
});
