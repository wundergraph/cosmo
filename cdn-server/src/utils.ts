import { S3ClientConfig } from '@aws-sdk/client-s3';

/**
 * controlplane and cdn are using the same code for handling the s3 storage.
 *
 * see: controlplane/test/utils.s3storage.test.ts for further details
 */

interface S3StorageOptions {
  url: string;
  region?: string;
  endpoint?: string;
  username?: string;
  password?: string;
  forcePathStyle?: boolean;
}

export function createS3ClientConfig(bucketName: string, opts: S3StorageOptions): S3ClientConfig {
  const url = new URL(opts.url);
  const { region, username, password } = opts;
  const forcePathStyle = opts.forcePathStyle ?? !isVirtualHostStyleUrl(url);
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

export function extractS3BucketName(opts: S3StorageOptions) {
  const url = new URL(opts.url);

  if (opts.forcePathStyle || !isVirtualHostStyleUrl(url)) {
    return url.pathname.slice(1);
  }

  return url.hostname.split('.')[0];
}

export function isVirtualHostStyleUrl(url: URL) {
  return url.hostname.split('.').length > 2;
}
