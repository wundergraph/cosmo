/*
 * Copyright (c) 2025 WunderGraph, Inc.
 *  All rights reserved.
 *  This software is proprietary and confidential. Usage of this software
 *  is only permitted under a valid license agreement. Unauthorized use,
 *  reproduction, or distribution of this software is prohibited.
 * For licensing information, please contact info@wundergraph.com
 */

declare global {
  interface Window {
    Osano: OsanoInstance;
  }

  type OsanoEvent = 'osano-cm-consent-saved' | 'osano-cm-ui-changed';

  interface OsanoInstance {
    (event: 'onInitialized', callback: (consent: OsanoConsent | undefined) => void): void;
    cm?: {
      readonly analytics: boolean;
      readonly marketing: boolean;
      hideWidget(): void;
      showDrawer(id: 'osano-cm-dom-info-dialog-open'): void;
      on(event: 'osano-cm-consent-saved', callback: (consent: OsanoConsent) => void);
      on(event: 'osano-cm-ui-changed', callback: (component: string, stateChange: 'hide' | 'show') => void);
    };
  }

  interface OsanoConsent {
    ANALYTICS: 'ACCEPT' | 'DENY';
    MARKETING: 'ACCEPT' | 'DENY';
    PERSONALIZATION: 'ACCEPT' | 'DENY';
    ESSENTIAL: 'ACCEPT' | 'DENY';
    'OPT-OUT': 'ACCEPT' | 'DENY';
    STORAGE: 'ACCEPT' | 'DENY';
  }
}

export {};
