import { useEffect } from 'react';
import Script from 'next/script';
import { Router } from 'next/router';
import { useOsanoConsentSaved } from '@/hooks/use-osano-consent-saved';
import { hasTrackingConsent, useTrackingConsent } from '@/hooks/use-tracking-consent';

declare global {
  interface Window {
    _hsq?: unknown[][];
  }
}

export function HubspotTrackingScript() {
  const scriptId = process.env.NEXT_PUBLIC_HUBSPOT_SCRIPT_ID;
  const hasConsent = useTrackingConsent();
  const isLoaded = !!scriptId && hasConsent;

  // The script can't be unloaded, so toggle HubSpot's do-not-track cookie instead.
  useOsanoConsentSaved((consent) => {
    window._hsq = window._hsq || [];
    window._hsq.push(hasTrackingConsent(consent) ? ['doNotTrack', { track: true }] : ['doNotTrack']);
  });

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const handleRouteChange = (path: string) => {
      window._hsq = window._hsq || [];
      window._hsq.push(['setPath', path]);
      window._hsq.push(['trackPageView']);
    };

    Router.events.on('routeChangeComplete', handleRouteChange);
    return () => {
      Router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [isLoaded]);

  return isLoaded ? (
    <Script id="hs-script-loader" strategy="afterInteractive" src={`https://js-eu1.hs-scripts.com/${scriptId}.js`} />
  ) : null;
}
