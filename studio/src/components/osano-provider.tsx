import { PropsWithChildren, createContext, useEffect, useMemo, useRef, useState } from 'react';

interface OsanoContextValue {
  consent: OsanoConsent;
}

export const OsanoContext = createContext<OsanoContextValue | null>(null);

export const DefaultOsanoConsent: OsanoConsent = {
  ANALYTICS: 'DENY',
  MARKETING: 'DENY',
  PERSONALIZATION: 'DENY',
  ESSENTIAL: 'ACCEPT',
  'OPT-OUT': 'DENY',
  STORAGE: 'DENY',
};

export function OsanoProvider({ children }: PropsWithChildren) {
  const osanoOnInitializedIsHooked = useRef(false);
  const [consent, setConsent] = useState(DefaultOsanoConsent);

  useEffect(() => {
    function onOsanoInitialized(consent: OsanoConsent | undefined) {
      // Consent saved on a previous visit arrives here, not via consent-saved.
      if (consent) {
        setConsent(consent);
        window.Osano.cm?.hideWidget();
      }

      window.Osano.cm?.on('osano-cm-consent-saved', onOsanoConsentSaved);
      window.Osano.cm?.on('osano-cm-ui-changed', onOsanoUiChanged);
    }

    // Consumers react to the consent state through useOsanoConsentSaved, so storing it is the only delivery.
    function onOsanoConsentSaved(consent: OsanoConsent) {
      setConsent(consent);
    }

    function onOsanoUiChanged(component: string, stateChange: 'hide' | 'show') {
      if (component === 'widget' && stateChange === 'show') {
        window.Osano.cm?.hideWidget();
      }
    }

    if (!osanoOnInitializedIsHooked.current && window.Osano) {
      osanoOnInitializedIsHooked.current = true;
      window.Osano('onInitialized', onOsanoInitialized);
    }
  }, []);

  const value = useMemo(() => ({ consent }), [consent]);

  return <OsanoContext.Provider value={value}>{children}</OsanoContext.Provider>;
}
