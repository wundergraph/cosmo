import { useCallback } from 'react';
import Script from 'next/script';
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

  // The script can't be unloaded, so toggle HubSpot's do-not-track cookie instead.
  const onConsentSaved = useCallback((consent: OsanoConsent) => {
    window._hsq = window._hsq || [];
    window._hsq.push(hasTrackingConsent(consent) ? ['doNotTrack', { track: true }] : ['doNotTrack']);
  }, []);

  useOsanoConsentSaved(onConsentSaved);

  return scriptId && hasConsent ? (
    <Script id="hs-script-loader" strategy="afterInteractive" src={`https://js-eu1.hs-scripts.com/${scriptId}.js`} />
  ) : null;
}
