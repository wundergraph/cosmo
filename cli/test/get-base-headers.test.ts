import { describe, test, expect } from 'vitest';
import { getBaseHeaders } from '../src/core/config.js';

describe('getBaseHeaders()', () => {
  test('Base headers contain a valid request ID', () => {
    const headers = getBaseHeaders();

    expect(headers).toHaveProperty('x-request-id');

    const requestId = (headers as Record<string, string>)["x-request-id"];

    expect(requestId).toBeTruthy();
    expect(requestId, "must be a valid UUID").toMatch(/^[\da-f]{8}-[\da-f]{4}-[0-5][\da-f]{3}-[089ab][\da-f]{3}-[\da-f]{12}$/i);
  })
})