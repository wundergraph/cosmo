import posthog from 'posthog-js';
import { useOsanoConsentSaved } from '@/hooks/use-osano-consent-saved';
import { hasTrackingConsent } from '@/hooks/use-tracking-consent';
import { Router } from 'next/router';
import { useEffect } from 'react';

// Drive PostHog opt-in/out from Osano consent. Without consent (reject or no
// prior decision) capturing stays cookieless/anonymous; on accept it switches
// to full cookie-based tracking.
export function PosthogConsentSync() {
  useEffect(() => {
    if (posthog.__loaded || !process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      return;
    }

    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: '/ingest',
      // Track rejected/default opt-out users anonymously (no cookies); switch to
      // full tracking only once the user opts in via Osano consent.
      cookieless_mode: 'on_reject',
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') ph.debug();
      },
      debug: process.env.NODE_ENV === 'development',
    });

    const handleRouteChange = () => posthog.capture('$pageview');
    Router.events.on('routeChangeComplete', handleRouteChange);

    return () => {
      Router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, []);

  useOsanoConsentSaved((consent) => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      return;
    }

    if (hasTrackingConsent(consent)) {
      posthog.opt_in_capturing();

      // Both transitions reset PostHog's flag state (opting out additionally
      // disables persistence, so rejecting users hold no cached flags at all).
      // Re-request in either direction, otherwise flags stay unresolved for
      // anyone who declines analytics cookies.
      posthog.reloadFeatureFlags();
    } else {
      posthog.opt_out_capturing();
    }
  });

  return null;
}
