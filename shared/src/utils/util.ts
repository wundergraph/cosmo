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

  let urlToParse = url;
  const hasProtocol = urlToParse.includes('://');
  if (!hasProtocol) {
    urlToParse = urlToParse.startsWith('//') ? `http:${urlToParse}` : `http://${urlToParse}`;
  }

  if (!URL.canParse(urlToParse)) {
    throw new Error('Invalid URL');
  }

  const parsedUrl = new URL(urlToParse);
  if (!parsedUrl.origin || parsedUrl.origin === 'null') {
    throw new Error('Invalid URL');
  }

  parsedUrl.search = '';
  parsedUrl.hash = '';

  let path = parsedUrl.pathname;
  const hasTrailingSlash = /^([^#?]*\/)(?:\?.*)?(?:#.*)?$/.test(urlToParse);
  if (!hasTrailingSlash && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return `${parsedUrl.origin}${path}`;
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
