import { useEffect, useRef, useState } from 'react';
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
  const { enabled, onboarding, setOnboarding } = useOnboarding();
  const { data, isError, isPending, error } = useQuery(getOnboarding);
  const [initialLoadSuccess, setInitialLoadSuccess] = useState(false);

  useEffect(
    function initialOnboardingFetch() {
      if (isPending) {
        return;
      }

      if (isError || data?.response?.code !== EnumStatusCode.OK) {
        setInitialLoadSuccess(false);
        return;
      }

      setInitialLoadSuccess(true);
      setOnboarding({
        step: Number(data.step ?? 0),
        finishedAt: data.finishedAt ? new Date(data.finishedAt) : undefined,
        federatedGraphsCount: data.federatedGraphsCount,
      });
    },
    [data, isError, isPending, setOnboarding, error],
  );

  useEffect(
    function handleNavigationToOnboarding() {
      // Redirect user back if onboarding metadata failed
      if (!initialLoadSuccess && Router.pathname.startsWith('/onboarding')) {
        Router.replace('/');
        return;
      }

      // Do not initiate redirect if we fail to fetch onboarding metadata. Fail silently in background.
      if (!initialLoadSuccess) {
        return;
      }

      // Do not initiate redirect if the user is not eligible for onboarding
      if (!onboarding && !enabled) {
        return;
      }

      // Do not initiate redirect if user has already finished the onboarding
      if (onboarding?.finishedAt) {
        return;
      }

      const path = onboarding ? `/onboarding/${onboarding.step}` : '/onboarding';
      Router.replace(path);
    },
    [onboarding, enabled, initialLoadSuccess],
  );
};
