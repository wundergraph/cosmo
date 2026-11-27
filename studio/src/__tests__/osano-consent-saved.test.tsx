import { cleanup, render } from '@testing-library/react';
import { act, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DefaultOsanoConsent, OsanoProvider } from '@/components/osano-provider';
import { useOsanoConsentSaved } from '@/hooks/use-osano-consent-saved';

const acceptedConsent: OsanoConsent = { ...DefaultOsanoConsent, ANALYTICS: 'ACCEPT', MARKETING: 'ACCEPT' };

function installOsano() {
  let onInitialized: ((consent: OsanoConsent | undefined) => void) | undefined;
  const handlers: Record<string, (...args: any[]) => void> = {};

  const osano = Object.assign(
    (event: string, handler: (consent: OsanoConsent | undefined) => void) => {
      if (event === 'onInitialized') {
        onInitialized = handler;
      }
    },
    {
      cm: {
        on: (event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        },
        hideWidget: () => {},
      },
    },
  );
  (window as any).Osano = osano;

  return {
    initialize: (consent?: OsanoConsent) => act(() => onInitialized?.(consent)),
    saveConsent: (consent: OsanoConsent) => act(() => handlers['osano-cm-consent-saved']?.(consent)),
  };
}

let rerenderConsumer: () => void = () => {};

function Consumer({ onConsent }: { onConsent: (consent: OsanoConsent) => void }) {
  const [, setRenders] = useState(0);
  rerenderConsumer = () => act(() => setRenders((renders) => renders + 1));

  // A new callback on every render, as an inline arrow function would be.
  useOsanoConsentSaved((consent) => onConsent(consent));
  return null;
}

function renderConsumer() {
  const onConsent = vi.fn();
  render(
    <OsanoProvider>
      <Consumer onConsent={onConsent} />
    </OsanoProvider>,
  );
  return onConsent;
}

let osano: ReturnType<typeof installOsano>;

beforeEach(() => {
  osano = installOsano();
});

afterEach(() => {
  cleanup();
  delete (window as any).Osano;
});

test('The default consent is delivered once when the consumer mounts', () => {
  const onConsent = renderConsumer();

  expect(onConsent).toHaveBeenCalledTimes(1);
  expect(onConsent).toHaveBeenLastCalledWith(DefaultOsanoConsent);
});

test('Consent restored by Osano on initialization is delivered once', () => {
  const onConsent = renderConsumer();
  osano.initialize(acceptedConsent);

  expect(onConsent).toHaveBeenCalledTimes(2);
  expect(onConsent).toHaveBeenLastCalledWith(acceptedConsent);
});

test('Consent saved by the user is delivered once', () => {
  const onConsent = renderConsumer();
  osano.initialize();
  osano.saveConsent(acceptedConsent);

  expect(onConsent).toHaveBeenCalledTimes(2);
  expect(onConsent).toHaveBeenLastCalledWith(acceptedConsent);
});

test('Consent is not delivered again when the consumer rerenders with a new callback', () => {
  const onConsent = renderConsumer();
  rerenderConsumer();
  rerenderConsumer();

  expect(onConsent).toHaveBeenCalledTimes(1);
});
