import { cleanup, render, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import MyApp from '@/pages/_app';
import EmbedSessionPage from '@/pages/embed/session';
import { AppPropsWithLayout } from '@/lib/page';

// Back on Hub differs from the test page only in its fragment, so the browser can follow it.
const backOnHub = `${window.location.origin}/#back-on-hub`;

const router = vi.hoisted(() => ({
  isReady: true,
  basePath: '',
  pathname: '/embed/session',
  asPath: '/embed/session',
  query: {} as Record<string, string>,
  replace: vi.fn(() => Promise.resolve(true)),
  push: vi.fn(() => Promise.resolve(true)),
  events: { on: () => {}, off: () => {} },
}));

vi.mock('next/router', () => ({ default: router, Router: router, useRouter: () => router }));

vi.mock('nuqs/adapters/next/pages', async () => {
  const { NuqsTestingAdapter } = await import('nuqs/adapters/testing');
  return {
    NuqsAdapter: ({ children }: { children: ReactNode }) => (
      <NuqsTestingAdapter searchParams={{ return: backOnHub }}>{children}</NuqsTestingAdapter>
    ),
  };
});

vi.mock('posthog-js', () => ({ default: { __loaded: true } }));

vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => children,
  useFeatureFlagEnabled: () => false,
}));

const organization = (slug: string, loginMethodAllowed: boolean) => ({
  id: `${slug}-id`,
  name: slug,
  slug,
  loginMethodAllowed,
  groups: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  features: [],
  billing: { plan: 'developer' },
  acceptedFeatureTerms: [],
});

const signedInWith = (organizations: ReturnType<typeof organization>[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'user-id', email: 'ada@example.com', organizations, invitations: [] }), {
          status: 200,
        }),
      ),
    ),
  );

const renderSessionPage = () =>
  render(<MyApp Component={EmbedSessionPage} pageProps={{}} router={{} as AppPropsWithLayout['router']} />);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_HUB_URL', window.location.origin);
  vi.stubEnv('NEXT_PUBLIC_COSMO_CP_URL', 'https://cp.example.com');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addListener: () => {}, removeListener: () => {} })),
  );
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  router.replace.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('/embed/session', () => {
  test('sends a signed-in user with no Cosmo organization back to Hub', async () => {
    signedInWith([]);

    renderSessionPage();

    await waitFor(() => expect(window.location.href).toBe(backOnHub));
    expect(router.replace).not.toHaveBeenCalled();
  });

  test('sends a user whose organizations the login method cannot open back to Hub', async () => {
    signedInWith([organization('acme', false)]);

    renderSessionPage();

    await waitFor(() => expect(window.location.href).toBe(backOnHub));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
