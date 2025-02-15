import { expect } from 'vitest';

export function expectUuid(str: string) {
  expect(str, "must be a valid UUID").toMatch(/^[\da-f]{8}-[\da-f]{4}-[0-5][\da-f]{3}-[089ab][\da-f]{3}-[\da-f]{12}$/i);
}

