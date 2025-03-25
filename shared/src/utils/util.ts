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
 * Normalize the URL by removing the trailing slash, fragments and query parameters.
 * Only the protocol, hostname, port and path are preserved.
 *
 * If no protocol is provided, defaults to https.
 * @param url
 */
export function normalizeURL(url: string): string {
  // return empty
  if (!url) {
    return url;
  }

  const urlToParse = url.includes('://') ? url : `https://${url}`;
  const parsedUrl = new URL(urlToParse);

  let path = parsedUrl.pathname;
  if (
    path.endsWith('/') &&
    !url.endsWith(`/${parsedUrl.search}${parsedUrl.hash}`) &&
    !url.endsWith(`/?${parsedUrl.hash}`)
  ) {
    path = path.slice(0, -1);
  }

  const port = parsedUrl.port ? `:${parsedUrl.port}` : '';
  return `${parsedUrl.protocol}//${parsedUrl.hostname}${port}${path}`;
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
