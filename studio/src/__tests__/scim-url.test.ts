import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('that the SCIM server URL is served by the configured control plane', async () => {
  vi.stubEnv('NEXT_PUBLIC_COSMO_CP_URL', 'http://localhost:4431');

  const { scimBaseURL } = await import('../lib/constants');

  expect(scimBaseURL).toBe('http://localhost:4431/scim/v2');
});
