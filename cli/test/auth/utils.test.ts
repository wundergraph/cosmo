import { describe, expect, test } from 'vitest';
import { isAccessTokenFresh } from '../../src/commands/auth/utils.js';

const now = new Date('2026-10-31T12:00:00Z');

describe('isAccessTokenFresh', () => {
  test('is fresh when the token expires in more than a minute', () => {
    expect(isAccessTokenFresh(new Date('2026-10-31T12:05:00Z'), now)).toBe(true);
  });

  test('is not fresh when the token expires within a minute', () => {
    expect(isAccessTokenFresh(new Date('2026-10-31T12:00:30Z'), now)).toBe(false);
  });

  test('is not fresh when the token expired less than a minute ago', () => {
    expect(isAccessTokenFresh(new Date('2026-10-31T11:59:30Z'), now)).toBe(false);
  });
});
