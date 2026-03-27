import Router from 'next/router';
import { useEffect } from 'react';

export default function OnboardingIndex() {
  useEffect(() => {
    Router.replace('/onboarding/welcome');
  }, []);

  return null;
}
