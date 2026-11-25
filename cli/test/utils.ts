import type { MockInstance } from 'vitest';

export function normalizeString(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function getJsonOutput(logSpy: MockInstance<typeof console.log>) {
  const call = logSpy.mock.calls.find(([arg]) => {
    try {
      JSON.parse(String(arg));
      return true;
    } catch {
      return false;
    }
  });

  if (!call) {
    throw new Error('No JSON output found in console.log calls');
  }

  return JSON.parse(String(call[0]));
}
