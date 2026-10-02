import { cleanup, render, screen } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { WorkspaceProvider } from '@/components/dashboard/workspace-provider';
import { useWorkspace } from '@/hooks/use-workspace';

const routeParams = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock('next/navigation', () => ({
  useParams: () => routeParams.current,
}));

// The mocked hooks must return stable references, as the provider's effects depend on them.
const workspaceQuery = {
  isLoading: false,
  data: {
    response: { code: EnumStatusCode.OK },
    namespaces: ['default', 'from-route', 'from-query'].map((name) => ({ id: name, name, graphs: [] })),
  },
};
const applyParams = vi.fn();

vi.mock('@connectrpc/connect-query', () => ({
  useQuery: () => workspaceQuery,
}));

vi.mock('@/components/analytics/use-apply-params', () => ({
  useApplyParams: () => applyParams,
}));

vi.mock('@/hooks/use-onboarding-navigation', () => ({
  useOnboardingNavigation: vi.fn(),
}));

function CurrentNamespace() {
  const { namespace } = useWorkspace();
  return <span data-testid="namespace">{namespace.name}</span>;
}

function renderProvider(searchParams = '') {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <WorkspaceProvider>
        <CurrentNamespace />
      </WorkspaceProvider>
    </NuqsTestingAdapter>,
  );
}

beforeEach(() => {
  routeParams.current = {};
  window.localStorage.clear();
});

afterEach(() => cleanup());

test('that the namespace is read from the route params', () => {
  routeParams.current = { namespace: 'from-route' };

  renderProvider();

  expect(screen.getByTestId('namespace').textContent).toBe('from-route');
});

test('that the namespace is read from the querystring', () => {
  renderProvider('?namespace=from-query');

  expect(screen.getByTestId('namespace').textContent).toBe('from-query');
});

test('that the route params win over the querystring', () => {
  routeParams.current = { namespace: 'from-route' };

  renderProvider('?namespace=from-query');

  expect(screen.getByTestId('namespace').textContent).toBe('from-route');
});
