import { describe, expect, test, vi } from 'vitest';
import { syncPostHogIdentity } from '../lib/track';

describe('syncPostHogIdentity', () => {
  test('aliases the current distinct id to the user email and groups by organization slug', () => {
    const posthogClient = {
      get_distinct_id: vi.fn().mockReturnValue('anonymous-id'),
      alias: vi.fn(),
      identify: vi.fn(),
      group: vi.fn(),
    } as any;

    syncPostHogIdentity(posthogClient, {
      id: 'user-id',
      email: 'user@example.com',
      organizationId: 'org-id',
      organizationName: 'Acme',
      organizationSlug: 'acme',
      plan: 'pro',
    });

    expect(posthogClient.alias).toHaveBeenCalledWith('user@example.com', 'anonymous-id');
    expect(posthogClient.identify).toHaveBeenCalledWith('user@example.com', {
      id: 'user-id',
      email: 'user@example.com',
      organizationId: 'org-id',
      organizationName: 'Acme',
      organizationSlug: 'acme',
      plan: 'pro',
    });
    expect(posthogClient.group).toHaveBeenCalledWith('orgslug', 'acme');
  });

  test('does not alias when the current distinct id already matches the email', () => {
    const posthogClient = {
      get_distinct_id: vi.fn().mockReturnValue('user@example.com'),
      alias: vi.fn(),
      identify: vi.fn(),
      group: vi.fn(),
    } as any;

    syncPostHogIdentity(posthogClient, {
      id: 'user-id',
      email: 'user@example.com',
      organizationId: 'org-id',
      organizationName: 'Acme',
      organizationSlug: 'acme',
    });

    expect(posthogClient.alias).not.toHaveBeenCalled();
    expect(posthogClient.identify).toHaveBeenCalledWith('user@example.com', {
      id: 'user-id',
      email: 'user@example.com',
      organizationId: 'org-id',
      organizationName: 'Acme',
      organizationSlug: 'acme',
      plan: undefined,
    });
    expect(posthogClient.group).toHaveBeenCalledWith('orgslug', 'acme');
  });
});
