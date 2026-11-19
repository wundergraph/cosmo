import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LaunchSandboxButton, LaunchSandboxNudge } from '@/components/launch-sandbox';
import { hubLaunchUrl } from '@/lib/hub';

const products = { name: 'products', namespace: 'prod', supportsFederation: true };

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('hubLaunchUrl', () => {
  test('points at Hub launch with the graph and namespace', () => {
    expect(hubLaunchUrl({ hubUrl: 'https://hub.example.com', graph: 'products', namespace: 'prod' })).toBe(
      'https://hub.example.com/launch?graph=products&namespace=prod',
    );
  });

  test('keeps a base path and encodes the values', () => {
    expect(hubLaunchUrl({ hubUrl: 'https://example.com/hub/', graph: 'my graph', namespace: 'a&b' })).toBe(
      'https://example.com/hub/launch?graph=my+graph&namespace=a%26b',
    );
  });

  test('names the Cosmo organization so Hub can set it up', () => {
    expect(
      hubLaunchUrl({
        hubUrl: 'https://hub.example.com',
        graph: 'products',
        namespace: 'prod',
        organization: 'acme & co',
      }),
    ).toBe('https://hub.example.com/launch?graph=products&namespace=prod&organization=acme+%26+co');
  });

  test('is undefined without a Hub URL or with the unreplaced Docker placeholder', () => {
    expect(hubLaunchUrl({ hubUrl: undefined, graph: 'products', namespace: 'prod' })).toBeUndefined();
    expect(hubLaunchUrl({ hubUrl: 'APP_NEXT_HUB_URL', graph: 'products', namespace: 'prod' })).toBeUndefined();
  });
});

describe('LaunchSandboxButton', () => {
  test('links to Hub launch for a federated graph', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_URL', 'https://hub.example.com');

    render(<LaunchSandboxButton graph={products} />);

    const link = screen.getByRole('link', { name: 'Launch sandbox' });
    expect(link.getAttribute('href')).toBe('https://hub.example.com/launch?graph=products&namespace=prod');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  test('is hidden when Studio has no Hub URL', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_URL', '');

    const { container } = render(<LaunchSandboxButton graph={products} />);

    expect(container.innerHTML).toBe('');
  });

  test('is hidden for a monograph', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_URL', 'https://hub.example.com');

    const { container } = render(<LaunchSandboxButton graph={{ ...products, supportsFederation: false }} />);

    expect(container.innerHTML).toBe('');
  });
});

describe('LaunchSandboxNudge', () => {
  test('invites trying a change in a sandbox', () => {
    vi.stubEnv('NEXT_PUBLIC_HUB_URL', 'https://hub.example.com');

    render(<LaunchSandboxNudge graph={products} />);

    expect(screen.getByText('Try a schema change against this graph without publishing it.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Launch sandbox' }).getAttribute('href')).toBe(
      'https://hub.example.com/launch?graph=products&namespace=prod',
    );
  });
});
