import { useEffect, useRef, useMemo } from 'react';
import Router from 'next/router';
import { useOnboarding } from './use-onboarding';
import { useQuery } from '@connectrpc/connect-query';
import { getOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';

/**
 * Manages the initial navigation to onboarding wizard and evaluates
 * the conditions based on feature flag and onboarding metadata
 */
export const useOnboardingNavigation = () => {
  const { enabled, setOnboarding, skipped, currentStep } = useOnboarding();
  const { data, isError, isPending } = useQuery(getOnboarding);
  const initialRedirect = useRef<boolean>(false);

  const initialLoadSuccess = useMemo(() => {
    if (isPending) return null;
    if (isError || data?.response?.code !== EnumStatusCode.OK) return false;
    return true;
  }, [isPending, isError, data]);

  useEffect(
    function syncOnboardingMetadata() {
      if (initialLoadSuccess !== true || !data) {
        return;
      }

      setOnboarding({
        finishedAt: data.finishedAt ? new Date(data.finishedAt) : undefined,
        federatedGraphsCount: data.federatedGraphsCount,
      });
    },
    [initialLoadSuccess, data, setOnboarding],
  );

  useEffect(
    function handleNavigationToOnboarding() {
      // Wait for the onboarding metadata query to resolve
      // Do not initiate redirect if we fail to fetch onboarding metadata. Fail silently in background.
      if (initialLoadSuccess === null || !initialLoadSuccess) {
        return;
      }

      // If user has dissmissed/skipped the onboarding but, do not redirect
      if (skipped) {
        return;
      }

      // If user has already finished the onboarding, don't redirect
      if (data?.finishedAt || (data?.federatedGraphsCount ?? 0) > 0) {
        return;
      }

      // skip redirecting on subsequent re-runs of this functions
      if (initialRedirect.current) {
        return;
      }

      const path = currentStep ? `/onboarding/${currentStep}` : `/onboarding/1`;
      initialRedirect.current = true;
      Router.replace(path);
    },
    [data, enabled, initialLoadSuccess, skipped, currentStep],
  );
};
