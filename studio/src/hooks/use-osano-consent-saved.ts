import { useContext, useEffect } from 'react';
import { OsanoContext } from '@/components/osano-provider';

export function useOsanoConsentSaved(callback: (consent: OsanoConsent) => void) {
  const context = useContext(OsanoContext);
  useEffect(() => {
    if (context?.consent) {
      // Beside the callback, we should trigger the consent sync when Osano is loaded
      callback?.(context.consent);
    }

    const unsubscribe = context?.subscribe(callback);
    return () => {
      unsubscribe?.();
    };
  }, [context, callback]);
}
