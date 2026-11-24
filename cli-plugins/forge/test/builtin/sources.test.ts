import { describe, expect, test } from 'vitest';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { parseRouterCandidate } from '../../src/builtin/sources.js';

const failureOf = (result: Result<object>) => (result.success ? undefined : toFailure(result));

describe('router candidates', () => {
  test.each([
    ['0.299.0', { release: '0.299.0' }],
    ['0.300.0-rc.1', { rc: '0.300.0-rc.1' }],
    ['1a182a7', { commit: '1a182a7' }],
  ])('%s is read as %o', (candidate, source) => {
    expect(parseRouterCandidate(candidate)).toEqual({ success: true, data: source });
  });

  test('anything else is rejected with the accepted forms', () => {
    expect(failureOf(parseRouterCandidate('latest'))).toMatchObject({
      message: '"latest" is not a router release, release candidate or commit.',
      input: 'latest',
      remediation: 'Pass a release such as 0.299.0, a release candidate such as 0.300.0-rc.1, or a commit SHA.',
    });
  });
});
