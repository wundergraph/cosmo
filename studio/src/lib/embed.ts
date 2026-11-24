import { buildUrl } from '@/lib/build-url';
import { hubOrigin } from '@/lib/hub';

export const embedSessionPath = '/embed/session';

export type HubMessage =
  | { source: 'cosmo-studio'; type: 'height'; height: number }
  | { source: 'cosmo-studio'; type: 'unauthorized' };

/** Posts to the Hub page framing Studio. Without a Hub URL there is no one to tell. */
export const postToHub = (message: HubMessage, target: Window = window.parent) => {
  const origin = hubOrigin(process.env.NEXT_PUBLIC_HUB_URL);
  if (!origin) {
    return;
  }

  target.postMessage(message, origin);
};

/** Where /embed/session sends a signed-in user: back to Hub, or Studio's home for any other `return`. */
export const embedSessionTarget = ({
  returnUrl,
  hubUrl,
}: {
  returnUrl: string | null;
  hubUrl: string | undefined;
}): string => {
  const origin = hubOrigin(hubUrl);
  if (!origin || !returnUrl || !URL.canParse(returnUrl) || new URL(returnUrl).origin !== origin) {
    return '/';
  }

  return returnUrl;
};

/** The controlplane login, which comes back to /embed/session with the same `return`. */
export const embedLoginUrl = ({
  controlplaneUrl,
  studioUrl,
  returnUrl,
}: {
  controlplaneUrl: string | undefined;
  studioUrl: string | undefined;
  returnUrl: string | null;
}): string =>
  buildUrl(`${controlplaneUrl}/v1/auth/login`, {
    redirectURL: buildUrl(`${studioUrl}${embedSessionPath}`, { return: returnUrl }),
  });
