import { SubscriptionProtocol, WebsocketSubprotocol } from '../router-config/builder.js';

export function delay(t: number) {
  return new Promise((resolve) => setTimeout(resolve, t));
}

const labelSeparator = '=';

export function splitLabel(label: string) {
  const [key, value] = label.split(labelSeparator);
  return {
    key,
    value,
  };
}

export function joinLabel({ key, value }: { key: string; value: string }) {
  return key + labelSeparator + value;
}

/**
 * Normalize the URL by removing the fragments and query parameters.
 * Only the protocol, hostname, port and path are preserved.
 * @param url
 */
export function normalizeURL(url: string): string {
  if (!url) {
    return url;
  }

  if (!URL.canParse(url)) {
    throw new Error('Invalid URL');
  }

  const indexOfQuery = url.indexOf('?');
  const indexOfFragment = url.indexOf('#');

  let urlBeforeQueryAndFragment = url;
  if (indexOfQuery > 0) {
    urlBeforeQueryAndFragment = urlBeforeQueryAndFragment.slice(
      0,
      indexOfFragment > 0 ? Math.min(indexOfQuery, indexOfFragment) : indexOfQuery,
    );
  } else if (indexOfFragment > 0) {
    urlBeforeQueryAndFragment = urlBeforeQueryAndFragment.slice(0, indexOfFragment);
  }

  return urlBeforeQueryAndFragment;
}

export function isValidUrl(url: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidSubscriptionProtocol(protocol: SubscriptionProtocol) {
  switch (protocol) {
    case 'sse':
    case 'sse_post':
    case 'ws': {
      return true;
    }
    default: {
      return false;
    }
  }
}

export function isValidWebsocketSubprotocol(protocol: WebsocketSubprotocol) {
  switch (protocol) {
    case 'auto':
    case 'graphql-ws':
    case 'graphql-transport-ws': {
      return true;
    }
    default: {
      return false;
    }
  }
}
