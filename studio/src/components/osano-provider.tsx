import { PropsWithChildren, createContext, useEffect, useState, useCallback, useRef } from 'react';
import { uid } from 'uid';

interface OsanoContextValue {
  consent: OsanoConsent;
  subscribe(callback: (consent: OsanoConsent) => void): () => void;
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
  const osanoContentSavedSubscriptions = useRef<Record<string, (consent: OsanoConsent) => void>>({});

  const [consent, setConsent] = useState(DefaultOsanoConsent);
  const subscribe = useCallback<OsanoContextValue['subscribe']>((callback) => {
    const id = uid(11);
    osanoContentSavedSubscriptions.current[id] = callback;
    return () => {
      delete osanoContentSavedSubscriptions.current[id];
    };
  }, []);

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

    function onOsanoConsentSaved(consent: OsanoConsent) {
      setConsent(consent);

      // window.Osano.cm?.on('osano-cm-ui-changed', onOsanoUiChanged)
      for (const callback of Object.values(osanoContentSavedSubscriptions.current)) {
        callback(consent);
      }
    }

    function onOsanoUiChanged(component: string, stateChange: 'hide' | 'show') {
      if (component === 'widget' && stateChange === 'show') {
        window.Osano.cm?.hideWidget();
      }
    }

    if (!osanoOnInitializedIsHooked.current) {
      osanoOnInitializedIsHooked.current = true;
      window.Osano('onInitialized', onOsanoInitialized);
    }
  }, []);

  return <OsanoContext.Provider value={{ consent, subscribe }}>{children}</OsanoContext.Provider>;
}
