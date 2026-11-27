import { useOsanoConsent } from '@/hooks/use-osano-consent';

export function hasTrackingConsent(consent: OsanoConsent) {
  return consent.ANALYTICS === 'ACCEPT' || consent.MARKETING === 'ACCEPT';
}

export function useTrackingConsent() {
  return hasTrackingConsent(useOsanoConsent());
}
