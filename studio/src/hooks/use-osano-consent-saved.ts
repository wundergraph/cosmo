import { useEffect, useRef } from 'react';
import { useOsanoConsent } from '@/hooks/use-osano-consent';

export function useOsanoConsentSaved(callback: (consent: OsanoConsent) => void) {
  const consent = useOsanoConsent();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    callbackRef.current(consent);
  }, [consent]);
}
