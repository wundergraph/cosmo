import * as S3 from '@aws-sdk/client-s3';
import { SubscriptionProtocol, WebsocketSubprotocol } from '../router-config/builder.js';
import { S3StorageOptions } from '../types/index.js';

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
 * @param url
 */
export function normalizeURL(url: string): string {
  // return empty
  if (!url) {
    return url;
  }

  const parsedUrl = new URL(url);
  let path = parsedUrl.pathname;

  // Remove the trailing slash if present
  if (path.endsWith('/')) {
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

export function createS3ClientConfig(bucketName: string, opts: S3StorageOptions): S3.S3ClientConfig {
  const url = new URL(opts.url);
  const { region, username, password } = opts;
  const forcePathStyle = !isVirtualHostStyleUrl(url);
  const endpoint = opts.endpoint || (forcePathStyle ? url.origin : url.origin.replace(`${bucketName}.`, ''));

  const accessKeyId = url.username || username || '';
  const secretAccessKey = url.password || password || '';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3 credentials. Please provide access key ID and secret access key.');
  }

  if (!region) {
    throw new Error('Missing region in S3 configuration.');
  }

  return {
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle,
  };
}

export function extractS3BucketName(s3Url: string) {
  const url = new URL(s3Url);

  if (isVirtualHostStyleUrl(url)) {
    return url.hostname.split('.')[0];
  }

  // path based style
  return url.pathname.slice(1);
}

export function isVirtualHostStyleUrl(url: URL) {
  return url.hostname.split('.').length > 2;
}
