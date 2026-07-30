import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { PostHogProvider } from 'posthog-js/react';
import type { PostHog } from 'posthog-js';
import { afterEach, expect, test } from 'vitest';
import {
  PostHogFeatureFlagProvider,
  usePostHogFeatureFlags,
} from '@/components/posthog-feature-flag-provider';

/**
 * Stub standing in for a PostHog client. The real `useFeatureFlagEnabled` hook
 * runs against it, so these tests cover the hook's own resolution behaviour
 * rather than a mock of it.
 */
function createClient() {
  let enabled: boolean | undefined;
  let hasLoadedFlags = false;
  const subscribers = new Set<() => void>();

  const client = {
    isFeatureEnabled: () => enabled,
    onFeatureFlags: (callback: () => void) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    featureFlags: {
      get hasLoadedFlags() {
        return hasLoadedFlags;
      },
    },
  } as unknown as PostHog;

  // Mirrors PostHog delivering flags: values become readable, then subscribers fire.
  const resolveFlags = (value: boolean) => {
    enabled = value;
    hasLoadedFlags = true;
    act(() => {
      subscribers.forEach((callback) => callback());
    });
  };

  return { client, resolveFlags };
}

function FlagState() {
  const { status, onboarding } = usePostHogFeatureFlags();
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="onboarding">{String(onboarding.enabled)}</span>
    </>
  );
}

function renderProvider(client: PostHog, disabled = false) {
  return render(
    <PostHogProvider client={client}>
      <PostHogFeatureFlagProvider disabled={disabled}>
        <span data-testid="child">studio</span>
        <FlagState />
      </PostHogFeatureFlagProvider>
    </PostHogProvider>,
  );
}

afterEach(() => cleanup());

test('that the studio renders while the flag is unresolved', () => {
  // Regression: an unresolved flag used to block the entire app behind a
  // loader, which never cleared when PostHog could not deliver flags at all.
  const { client } = createClient();

  renderProvider(client);

  expect(screen.getByTestId('child')).toBeDefined();
  expect(screen.getByTestId('status').textContent).toBe('success');
  expect(screen.getByTestId('onboarding').textContent).toBe('false');
});

test('that onboarding stays disabled when the flag never resolves', () => {
  const { client } = createClient();

  renderProvider(client);

  expect(screen.getByTestId('onboarding').textContent).toBe('false');
});

test('that onboarding is enabled once the flag resolves to true', () => {
  const { client, resolveFlags } = createClient();

  renderProvider(client);
  expect(screen.getByTestId('onboarding').textContent).toBe('false');

  resolveFlags(true);

  expect(screen.getByTestId('onboarding').textContent).toBe('true');
});

test('that onboarding stays disabled once the flag resolves to false', () => {
  const { client, resolveFlags } = createClient();

  renderProvider(client);
  resolveFlags(false);

  expect(screen.getByTestId('onboarding').textContent).toBe('false');
});

test('that onboarding stays disabled without a PostHog key, even if the flag is true', () => {
  const { client, resolveFlags } = createClient();

  renderProvider(client, true);
  resolveFlags(true);

  expect(screen.getByTestId('child')).toBeDefined();
  expect(screen.getByTestId('status').textContent).toBe('disabled');
  expect(screen.getByTestId('onboarding').textContent).toBe('false');
});
