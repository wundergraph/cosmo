import { useContext } from 'react';
import { OnboardingContext } from '@/components/onboarding/onboarding-provider';

export const useOnboarding = () => useContext(OnboardingContext);
