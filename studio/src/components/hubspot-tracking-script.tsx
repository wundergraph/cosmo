import { useEffect, useState } from 'react';
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
  const isTrackingAllowed = !!scriptId && hasConsent;
  const [isTrackerReady, setIsTrackerReady] = useState(false);

  // The script can't be unloaded, so toggle HubSpot's do-not-track cookie instead.
  useOsanoConsentSaved((consent) => {
    window._hsq = window._hsq || [];
    window._hsq.push(hasTrackingConsent(consent) ? ['doNotTrack', { track: true }] : ['doNotTrack']);
  });

  // HubSpot records the current path when the script loads, so only navigations after that need a manual page view.
  useEffect(() => {
    if (!isTrackingAllowed || !isTrackerReady) {
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
  }, [isTrackingAllowed, isTrackerReady]);

  return isTrackingAllowed ? (
    <Script
      id="hs-script-loader"
      strategy="afterInteractive"
      src={`https://js-eu1.hs-scripts.com/${scriptId}.js`}
      onLoad={() => setIsTrackerReady(true)}
    />
  ) : null;
}
