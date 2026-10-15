import { describe, expect, test } from 'vitest';
import { createRouterConfigMetadata } from '../../src/core/util/composition.js';

describe('createRouterConfigMetadata', () => {
  test('omits router config signature metadata when no signature is available', () => {
    expect(createRouterConfigMetadata({ version: 'schema-version-id' })).toStrictEqual({
      version: 'schema-version-id',
    });
  });

  test('includes router config signature metadata when a signature is available', () => {
    expect(createRouterConfigMetadata({ version: 'schema-version-id', signature: 'signature' })).toStrictEqual({
      version: 'schema-version-id',
      'signature-sha256': 'signature',
    });
  });
});
