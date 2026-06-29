import { useEffect, useState } from 'react';

interface OsanoConsent {
  ANALYTICS?: string;
  MARKETING?: string;
}

declare global {
  interface Window {
    Osano?: {
      cm?: {
        getConsent?: () => OsanoConsent;
        addEventListener: (event: string, callback: (consent?: OsanoConsent) => void) => void;
      };
    };
  }
}

// Accepting analytics or marketing is the gate for PostHog/Reo tracking.
export function hasAnalyticsConsent(consent: OsanoConsent | undefined): boolean {
  return consent?.ANALYTICS === 'ACCEPT' || consent?.MARKETING === 'ACCEPT';
}

// Reactive Osano analytics-consent state, so consumers can re-run effects when
// the user accepts/rejects (Osano is only present in production).
export function useAnalyticsConsent(): boolean {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const update = (): void => setConsented(hasAnalyticsConsent(window.Osano?.cm?.getConsent?.()));

    const onOsanoReady = (): void => {
      update();
      window.Osano?.cm?.addEventListener('osano-cm-consent-changed', update);
    };

    if (window.Osano?.cm) {
      onOsanoReady();
      return;
    }

    window.addEventListener('osano-cm-initialized', onOsanoReady, { once: true });
    return () => window.removeEventListener('osano-cm-initialized', onOsanoReady);
  }, []);

  return consented;
}
