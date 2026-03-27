import { useMemo } from 'react';
import { useFeatureFlagEnabled } from 'posthog-js/react';

/**
 * Evaluates whether the user should have an onboarding wizard
 * activated.
 * @todo The hook will receive a session object with additional
 *       metadata to evaluate the condition
 */
export function useOnboarding(): { enabled: boolean } {
  const onboardingFlagEnabled = useFeatureFlagEnabled('cosmo-onboarding-v1');

  return useMemo(() => ({ enabled: Boolean(onboardingFlagEnabled) }), [onboardingFlagEnabled]);
}
