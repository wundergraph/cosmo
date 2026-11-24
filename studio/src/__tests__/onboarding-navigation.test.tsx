import { cleanup, renderHook } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OnboardingContext, OnboardingState } from '@/components/onboarding/onboarding-provider';
import { useOnboardingNavigation } from '@/hooks/use-onboarding-navigation';

const router = vi.hoisted(() => ({ query: {}, replace: vi.fn() }));

vi.mock('next/router', () => ({ default: router }));

// An organization that has not finished onboarding and has no graphs.
const onboardingQuery = {
  isPending: false,
  isError: false,
  data: { response: { code: EnumStatusCode.OK }, federatedGraphsCount: 0 },
};

vi.mock('@connectrpc/connect-query', () => ({ useQuery: () => onboardingQuery }));

const onboarding: OnboardingState = {
  enabled: true,
  onboarding: undefined,
  setOnboarding: () => undefined,
  currentStep: undefined,
  setStep: () => undefined,
  skipped: false,
  initialized: false,
  setInitialized: () => undefined,
  setSkipped: () => undefined,
  resetSkipped: () => undefined,
};

const renderNavigation = (searchParams: string) =>
  renderHook(() => useOnboardingNavigation(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NuqsTestingAdapter searchParams={searchParams}>
        <OnboardingContext.Provider value={onboarding}>{children}</OnboardingContext.Provider>
      </NuqsTestingAdapter>
    ),
  });

afterEach(() => {
  cleanup();
  router.replace.mockReset();
});

describe('useOnboardingNavigation', () => {
  test('sends an organization with no graphs to onboarding', () => {
    renderNavigation('');

    expect(router.replace).toHaveBeenCalledExactlyOnceWith('/onboarding/1');
  });

  test('stays on the page inside Hub', () => {
    renderNavigation('?embed=1');

    expect(router.replace).not.toHaveBeenCalled();
  });
});
