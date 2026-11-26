import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppProvider } from '@/components/app-provider';
import { EmbedLayout } from '@/components/layout/embed-layout';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { useUser } from '@/hooks/use-user';
import { embedLoginUrl, embedSessionTarget } from '@/lib/embed';

const router = vi.hoisted(() => ({
  current: {
    isReady: true,
    basePath: '',
    pathname: '/[organizationSlug]/members',
    asPath: '/globex/members',
    query: { organizationSlug: 'globex' } as Record<string, string>,
    replace: (_url: string) => Promise.resolve(true),
  },
}));

vi.mock('next/router', () => ({ useRouter: () => router.current }));

vi.mock('@/components/dashboard/workspace-provider', () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/pages/account/join', () => ({ default: () => null }));

const hubOrigin = 'https://hub.example.com';

const organization = (slug: string) => ({
  id: `${slug}-id`,
  name: slug,
  slug,
  groups: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  features: [],
  billing: { plan: 'developer' },
  acceptedFeatureTerms: [],
});

const respondWithSession = (status: number) => {
  const body = {
    id: 'user-id',
    email: 'ada@example.com',
    organizations: [organization('acme'), organization('globex')],
    invitations: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(status === 200 ? JSON.stringify(body) : null, { status }))),
  );
};

function CurrentOrganization() {
  const user = useUser();
  return <span data-testid="organization">{user?.currentOrganization.slug}</span>;
}

const renderApp = (searchParams: string) =>
  render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider>
          <CurrentOrganization />
        </AppProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_HUB_URL', `${hubOrigin}/app`);
  vi.stubEnv('NEXT_PUBLIC_COSMO_STUDIO_URL', 'https://studio.example.com');
  router.current.replace = vi.fn(() => Promise.resolve(true));
  router.current.query = { organizationSlug: 'globex' };
  document.cookie = 'cosmo_org=acme; path=/';
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('embedSessionTarget', () => {
  test('returns to a Hub URL', () => {
    expect(
      embedSessionTarget({ returnUrl: 'https://hub.example.com/acme/settings/members', hubUrl: `${hubOrigin}/app` }),
    ).toBe('https://hub.example.com/acme/settings/members');
  });

  test("sends every other return to Studio's home", () => {
    for (const returnUrl of [
      'https://evil.example.com/acme',
      'https://hub.example.com.evil.example.com/',
      'http://hub.example.com/acme',
      '//evil.example.com',
      'javascript:alert(1)',
      '/acme/members',
      null,
    ]) {
      expect(embedSessionTarget({ returnUrl, hubUrl: hubOrigin })).toBe('/');
    }
  });

  test("sends a user to Studio's home when Studio has no Hub URL", () => {
    expect(embedSessionTarget({ returnUrl: 'https://hub.example.com/acme', hubUrl: undefined })).toBe('/');
    expect(embedSessionTarget({ returnUrl: 'https://hub.example.com/acme', hubUrl: 'APP_NEXT_HUB_URL' })).toBe('/');
  });
});

describe('embedLoginUrl', () => {
  test('signs in at the controlplane and comes back to /embed/session with the same return', () => {
    const loginUrl = new URL(
      embedLoginUrl({
        controlplaneUrl: 'https://cp.example.com',
        studioUrl: 'https://studio.example.com',
        returnUrl: 'https://hub.example.com/acme/settings?tab=members',
      }),
    );

    expect(loginUrl.origin + loginUrl.pathname).toBe('https://cp.example.com/v1/auth/login');
    expect(loginUrl.searchParams.get('redirectURL')).toBe(
      'https://studio.example.com/embed/session?return=https%3A%2F%2Fhub.example.com%2Facme%2Fsettings%3Ftab%3Dmembers',
    );
  });
});

describe('EmbedLayout', () => {
  test('posts its height to Hub on load and on every resize', () => {
    let height = 640;
    let resized = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {
          resized();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 800, height));
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    render(<EmbedLayout>members</EmbedLayout>);
    height = 900.4;
    resized();

    expect(postMessage.mock.calls).toEqual([
      [{ source: 'cosmo-studio', type: 'height', height: 640, overlay: false }, hubOrigin],
      [{ source: 'cosmo-studio', type: 'height', height: 901, overlay: false }, hubOrigin],
    ]);
  });

  test('tells Hub while a dialog is open, and posts the content height whatever size the dialog takes', async () => {
    let frameHeight = 300;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    // A full-height sheet is as tall as the frame.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? new DOMRect(0, 0, 800, frameHeight) : new DOMRect(0, 0, 800, 300);
    });
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      frameHeight = message.overlay ? 900 : message.height;
    });

    render(<EmbedLayout>members</EmbedLayout>);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    dialog.append(document.createElement('p'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    dialog.remove();
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));

    expect(postMessage.mock.calls).toEqual([
      [{ source: 'cosmo-studio', type: 'height', height: 300, overlay: false }, hubOrigin],
      [{ source: 'cosmo-studio', type: 'height', height: 300, overlay: true }, hubOrigin],
      [{ source: 'cosmo-studio', type: 'height', height: 300, overlay: false }, hubOrigin],
    ]);
  });

  test('posts nothing without a Hub URL', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_URL', '');
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    render(<EmbedLayout>members</EmbedLayout>);

    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('AppProvider embedded in Hub', () => {
  test('tells Hub the session is missing instead of redirecting to login', async () => {
    respondWithSession(401);
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    renderApp('?embed=1');

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ source: 'cosmo-studio', type: 'unauthorized' }, hubOrigin),
    );
    expect(router.current.replace).not.toHaveBeenCalled();
  });

  test('redirects to login when not embedded', async () => {
    respondWithSession(401);
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    renderApp('');

    await waitFor(() =>
      expect(router.current.replace).toHaveBeenCalledWith(
        '/login?redirectURL=https%3A%2F%2Fstudio.example.com%2Fglobex%2Fmembers',
      ),
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  test('uses the organization in the URL and leaves the org cookie alone', async () => {
    respondWithSession(200);

    renderApp('?embed=1');

    await waitFor(() => expect(screen.getByTestId('organization').textContent).toBe('globex'));
    expect(document.cookie).toContain('cosmo_org=acme');
    expect(router.current.replace).not.toHaveBeenCalled();
  });

  test('tells Hub only that the session is missing, with no page height first', async () => {
    respondWithSession(401);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    render(
      <NuqsTestingAdapter searchParams="?embed=1">
        <QueryClientProvider client={new QueryClient()}>
          <AppProvider>{getDashboardLayout(<span>members</span>, 'Members', '')}</AppProvider>
        </QueryClientProvider>
      </NuqsTestingAdapter>,
    );

    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postMessage.mock.calls).toEqual([[{ source: 'cosmo-studio', type: 'unauthorized' }, hubOrigin]]);
  });

  test('says so when the user is not a member of the organization in the URL', async () => {
    respondWithSession(200);
    router.current.query = { organizationSlug: 'initech' };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );

    renderApp('?embed=1');

    expect(await screen.findByText('You are not a member of this Cosmo organization')).toBeTruthy();
    expect(router.current.replace).not.toHaveBeenCalled();
  });
});
