import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectFetchPairs,
  dedupeCacheKeysForDisplay,
  formatCacheKey,
  summarizeFetchIdentity,
} from './cache-explorer-utils';
import type { FetchPlanNode } from './cache-explorer-types';

const leaf = (overrides: Partial<FetchPlanNode>): FetchPlanNode => ({
  kind: 'Entity',
  path: 'articles.@.relatedArticles',
  sourceName: 'cachegraph',
  query: 'query Q { _entities { ... on Article { id title tags } } }',
  representations: undefined,
  cacheKeys: undefined,
  responseData: undefined,
  loadSkipped: false,
  loadDurationMs: 0,
  bodySize: 0,
  l1Hits: 0,
  l1Misses: 0,
  l2Hits: 0,
  l2Misses: 0,
  l2GetDurationMs: 0,
  entityCount: 1,
  children: [],
  ...overrides,
});

const container = (...children: FetchPlanNode[]): FetchPlanNode => ({
  kind: 'Sequence',
  path: '',
  query: undefined,
  cacheKeys: undefined,
  responseData: undefined,
  sourceName: undefined,
  loadSkipped: false,
  loadDurationMs: 0,
  bodySize: 0,
  l1Hits: 0,
  l1Misses: 0,
  l2Hits: 0,
  l2Misses: 0,
  l2GetDurationMs: 0,
  entityCount: 0,
  children,
});

test('formatCacheKey strips synthetic cache explorer prefixes from displayed keys', () => {
  const raw = 'cache-explorer-abc123{"__typename":"Article","key":{"id":"2"}}';
  assert.equal(
    formatCacheKey(raw),
    '{\n  "__typename": "Article",\n  "key": {\n    "id": "2"\n  }\n}',
  );

  const legacyRaw = 'explorer-legacy{"__typename":"Article","key":{"id":"3"}}';
  assert.equal(
    formatCacheKey(legacyRaw),
    '{\n  "__typename": "Article",\n  "key": {\n    "id": "3"\n  }\n}',
  );
});

test('dedupeCacheKeysForDisplay removes duplicate entity keys while preserving first-seen order', () => {
  const keys = [
    'cache-explorer-run{"__typename":"Article","key":{"id":"3"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"4"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"1"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"3"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"1"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"2"}}',
  ];

  assert.deepEqual(dedupeCacheKeysForDisplay(keys), [
    'cache-explorer-run{"__typename":"Article","key":{"id":"3"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"4"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"1"}}',
    'cache-explorer-run{"__typename":"Article","key":{"id":"2"}}',
  ]);
});

test('collectFetchPairs matches fetches by stable entity identity instead of child index', () => {
  const cachedPlan = container(
    leaf({
      loadSkipped: true,
      cacheKeys: ['cache-explorer-run{"__typename":"Article","key":{"id":"2"}}'],
    }),
    leaf({
      loadSkipped: true,
      cacheKeys: ['cache-explorer-run{"__typename":"Article","key":{"id":"3"}}'],
    }),
  );

  const uncachedPlan = container(
    leaf({
      responseData: {
        _entities: [{ __typename: 'Article', id: '3', title: 'Cache Invalidation Strategies' }],
      },
    }),
    leaf({
      responseData: {
        _entities: [{ __typename: 'Article', id: '2', title: 'Advanced Federation Patterns' }],
      },
    }),
  );

  const pairs = collectFetchPairs(cachedPlan, uncachedPlan);
  assert.equal(pairs.length, 2);

  assert.deepEqual(pairs[0].pair.cached?.cacheKeys, [
    'cache-explorer-run{"__typename":"Article","key":{"id":"2"}}',
  ]);
  assert.deepEqual(pairs[0].pair.uncached?.responseData, {
    _entities: [{ __typename: 'Article', id: '2', title: 'Advanced Federation Patterns' }],
  });

  assert.deepEqual(pairs[1].pair.cached?.cacheKeys, [
    'cache-explorer-run{"__typename":"Article","key":{"id":"3"}}',
  ]);
  assert.deepEqual(pairs[1].pair.uncached?.responseData, {
    _entities: [{ __typename: 'Article', id: '3', title: 'Cache Invalidation Strategies' }],
  });
});

test('collectFetchPairs matches semantically identical fetches even when query shape differs', () => {
  const cachedPlan = container(
    leaf({
      kind: 'Single',
      sourceName: 'cachegraph',
      path: 'articles.@.relatedArticles',
      query: 'query A { _entities(representations: $reps) { ... on Article { title tags } } }',
      cacheKeys: ['cache-explorer-run{"__typename":"Article","key":{"id":"2"}}'],
      loadSkipped: true,
    }),
  );

  const uncachedPlan = container(
    leaf({
      kind: 'BatchEntity',
      sourceName: 'cachegraph',
      path: 'articles.@.relatedArticles',
      query: 'query B { _entities(representations: $reps) { ... on Article { __typename title tags } } }',
      responseData: {
        _entities: [{ __typename: 'Article', id: '2', title: 'Advanced Federation Patterns' }],
      },
    }),
  );

  const pairs = collectFetchPairs(cachedPlan, uncachedPlan);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].pair.cached?.cacheKeys, [
    'cache-explorer-run{"__typename":"Article","key":{"id":"2"}}',
  ]);
  assert.deepEqual(pairs[0].pair.uncached?.responseData, {
    _entities: [{ __typename: 'Article', id: '2', title: 'Advanced Federation Patterns' }],
  });
});

test('collectFetchPairs matches batch entity fetches by representations when response items have no ids', () => {
  const cachedPlan = container(
    leaf({
      kind: 'BatchEntity',
      sourceName: 'cachegraph',
      path: 'articles.@.relatedArticles',
      query: 'query A { _entities(representations: $reps) { ... on Article { __typename title tags } } }',
      representations: [
        { __typename: 'Article', id: '3' },
        { __typename: 'Article', id: '4' },
        { __typename: 'Article', id: '1' },
        { __typename: 'Article', id: '2' },
      ],
      cacheKeys: [
        'cache-explorer-run{"__typename":"Article","key":{"id":"3"}}',
        'cache-explorer-run{"__typename":"Article","key":{"id":"4"}}',
        'cache-explorer-run{"__typename":"Article","key":{"id":"1"}}',
        'cache-explorer-run{"__typename":"Article","key":{"id":"2"}}',
      ],
      responseData: {
        _entities: [
          { __typename: 'Article', title: 'Cache Invalidation Strategies' },
          { __typename: 'Article', title: 'Performance Tuning with Entity Caching' },
          { __typename: 'Article', title: 'Introduction to GraphQL Caching' },
          { __typename: 'Article', title: 'Advanced Federation Patterns' },
        ],
      },
      loadSkipped: true,
    }),
    leaf({
      kind: 'BatchEntity',
      sourceName: 'cachegraph',
      path: 'articles.@.relatedArticles',
      query: 'query B { _entities(representations: $reps) { ... on Article { __typename title tags } } }',
      representations: [
        { __typename: 'Article', id: '3' },
        { __typename: 'Article', id: '4' },
        { __typename: 'Article', id: '1' },
        { __typename: 'Article', id: '3' },
      ],
      responseData: {
        _entities: [
          { __typename: 'Article', title: 'Cache Invalidation Strategies' },
          { __typename: 'Article', title: 'Performance Tuning with Entity Caching' },
          { __typename: 'Article', title: 'Introduction to GraphQL Caching' },
          { __typename: 'Article', title: 'Cache Invalidation Strategies' },
        ],
      },
      loadSkipped: true,
    }),
  );

  const uncachedPlan = container(
    leaf({
      kind: 'BatchEntity',
      sourceName: 'cachegraph',
      path: 'articles.@.relatedArticles',
      query: 'query C { _entities(representations: $reps) { ... on Article { __typename title tags } } }',
      representations: [
        { __typename: 'Article', id: '3' },
        { __typename: 'Article', id: '4' },
        { __typename: 'Article', id: '1' },
        { __typename: 'Article', id: '3' },
      ],
      responseData: {
        _entities: [
          { __typename: 'Article', title: 'Cache Invalidation Strategies' },
          { __typename: 'Article', title: 'Performance Tuning with Entity Caching' },
          { __typename: 'Article', title: 'Introduction to GraphQL Caching' },
          { __typename: 'Article', title: 'Cache Invalidation Strategies' },
        ],
      },
    }),
    leaf({
      kind: 'BatchEntity',
      sourceName: 'cachegraph',
      path: 'articles.@.relatedArticles',
      query: 'query D { _entities(representations: $reps) { ... on Article { __typename title tags } } }',
      representations: [
        { __typename: 'Article', id: '3' },
        { __typename: 'Article', id: '4' },
        { __typename: 'Article', id: '1' },
        { __typename: 'Article', id: '2' },
      ],
      responseData: {
        _entities: [
          { __typename: 'Article', title: 'Cache Invalidation Strategies' },
          { __typename: 'Article', title: 'Performance Tuning with Entity Caching' },
          { __typename: 'Article', title: 'Introduction to GraphQL Caching' },
          { __typename: 'Article', title: 'Advanced Federation Patterns' },
        ],
      },
    }),
  );

  const pairs = collectFetchPairs(cachedPlan, uncachedPlan);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0].pair.cached?.representations, [
    { __typename: 'Article', id: '3' },
    { __typename: 'Article', id: '4' },
    { __typename: 'Article', id: '1' },
    { __typename: 'Article', id: '2' },
  ]);
  assert.deepEqual(pairs[0].pair.uncached?.representations, [
    { __typename: 'Article', id: '3' },
    { __typename: 'Article', id: '4' },
    { __typename: 'Article', id: '1' },
    { __typename: 'Article', id: '2' },
  ]);
});

test('summarizeFetchIdentity exposes a readable row label for paired fetches', () => {
  const node = leaf({
    cacheKeys: ['cache-explorer-run{"__typename":"Article","key":{"id":"2"}}'],
  });
  assert.equal(summarizeFetchIdentity(node), 'Article{id:2}');
});
