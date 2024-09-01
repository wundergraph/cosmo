import { S3ClientConfig } from '@aws-sdk/client-s3';

// see: controlplane/test/utils.s3storage.test.ts
export function createS3ClientConfig(
  s3Url: string,
  bucketName: string,
  region: string | undefined,
  endpoint: string | undefined,
): S3ClientConfig {
  const url = new URL(s3Url);
  const forcePathStyle = !isVirtualHostStyleUrl(url);

  const accessKeyId = url.username ?? '';
  const secretAccessKey = url.password ?? '';

  if (forcePathStyle && !endpoint) {
    endpoint = url.origin;
  }

  if (!forcePathStyle && !endpoint) {
    endpoint = url.origin.replace(`${bucketName}.`, '');
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
