// Vitest stalls in the offline image, so these tests exercise built control plane utilities with Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractOperationNames,
  isValidGrpcNamingScheme,
  isValidLabels,
  normalizePagination,
} from '../controlplane/dist/core/util.js';

test('labels reject malformed names', () => {
  assert.equal(isValidLabels([{ key: 'team', value: 'alpha' }]), true);
  assert.equal(isValidLabels([{ key: 'team*', value: 'alpha' }]), false);
});

test('operation names come from the GraphQL document', () => {
  assert.deepEqual(extractOperationNames('query First { hello } query Second { world }'), ['First', 'Second']);
});

test('pagination clamps untrusted values', () => {
  assert.deepEqual(normalizePagination({ limit: 100, offset: 600_000 }), { limit: 50, offset: 500_000 });
});

test('gRPC endpoint names reject HTTP URLs', () => {
  assert.equal(isValidGrpcNamingScheme('dns:///localhost:5000'), true);
  assert.equal(isValidGrpcNamingScheme('https://example.com'), false);
});
