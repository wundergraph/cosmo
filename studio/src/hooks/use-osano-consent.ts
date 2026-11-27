import { useContext } from 'react';
import { DefaultOsanoConsent, OsanoContext } from '@/components/osano-provider';

export function useOsanoConsent() {
  const context = useContext(OsanoContext);

  return context?.consent ?? DefaultOsanoConsent;
}
