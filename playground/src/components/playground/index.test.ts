import { describe, expect, it } from 'vitest';

import { applyCacheModeHeaders } from './index';

describe('applyCacheModeHeaders', () => {
  it('preserves existing headers while switching cache modes', () => {
    let headers = JSON.stringify(
      {
        Authorization: 'Bearer test-token',
        'X-WG-Disable-Entity-Cache': 'true',
      },
      null,
      2,
    );

    headers = applyCacheModeHeaders(headers, 'no-l1')!;
    expect(JSON.parse(headers)).toEqual({
      Authorization: 'Bearer test-token',
      'X-WG-Disable-Entity-Cache-L1': 'true',
    });

    headers = applyCacheModeHeaders(headers, 'no-l2')!;
    expect(JSON.parse(headers)).toEqual({
      Authorization: 'Bearer test-token',
      'X-WG-Disable-Entity-Cache-L2': 'true',
    });

    headers = applyCacheModeHeaders(headers, 'enabled')!;
    expect(JSON.parse(headers)).toEqual({
      Authorization: 'Bearer test-token',
    });
  });

  it('leaves invalid JSON untouched', () => {
    expect(applyCacheModeHeaders('{not-json', 'disabled')).toBe('{not-json');
  });
});
