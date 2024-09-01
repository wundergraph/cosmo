import { describe, expect, test } from 'vitest';
import { createS3ClientConfig, extractS3BucketName, isVirtualHostStyleUrl } from '../src/core/util.js';

describe('S3 Utils', () => {
  describe('createS3ClientConfig', () => {
    test('that it correctly configures an S3 client for a path-style URL', () => {
      const s3Url = 'http://username:password@minio:9000/cosmo';
      const bucketName = 'cosmo';
      const region = 'auto';
      const endpoint = undefined;

      const config = createS3ClientConfig(s3Url, bucketName, region, endpoint);

      expect(config).toEqual({
        region: 'auto',
        endpoint: 'http://minio:9000',
        credentials: {
          accessKeyId: 'username',
          secretAccessKey: 'password',
        },
        forcePathStyle: true,
      });
    });

    test('that it correctly configures an S3 client for a virtual-hosted-style URL with provided endpoint', () => {
      const s3Url = 'https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com';
      const bucketName = 'cosmo-controlplane-bucket';
      const region = 'us-east-1';
      const endpoint = 's3.amazonaws.com';

      const config = createS3ClientConfig(s3Url, bucketName, region, endpoint);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 's3.amazonaws.com',
        credentials: {
          accessKeyId: 'username',
          secretAccessKey: 'password',
        },
        forcePathStyle: false,
      });
    });

    test('that it correctly configures an S3 client for a virtual-hosted-style URL without provided endpoint', () => {
      const s3Url = 'https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com';
      const bucketName = 'cosmo-controlplane-bucket';
      const region = 'us-east-1';
      const endpoint = undefined;

      const config = createS3ClientConfig(s3Url, bucketName, region, endpoint);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 'https://s3.amazonaws.com',
        credentials: {
          accessKeyId: 'username',
          secretAccessKey: 'password',
        },
        forcePathStyle: false,
      });
    });

    test('that it handles missing username and password in the URL correctly', () => {
      const s3Url = 'https://cosmo-controlplane-bucket.s3.amazonaws.com';
      const bucketName = 'cosmo-controlplane-bucket';
      const region = 'us-east-1';
      const endpoint = '';

      const config = createS3ClientConfig(s3Url, bucketName, region, endpoint);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 'https://s3.amazonaws.com',
        credentials: {
          accessKeyId: '',
          secretAccessKey: '',
        },
        forcePathStyle: false,
      });
    });
  });

  describe('extractS3BucketName', () => {
    test('that it returns the correct bucket name for a virtual-hosted-style URL', () => {
      const s3Url = 'https://cosmo-controlplane-bucket.s3.amazonaws.com/some/object';

      const bucketName = extractS3BucketName(s3Url);

      expect(bucketName).toBe('cosmo-controlplane-bucket');
    });

    test('that it returns the correct bucket name for a path-style URL', () => {
      const s3Url = 'http://minio:9000/cosmo';

      const bucketName = extractS3BucketName(s3Url);

      expect(bucketName).toBe('cosmo');
    });

    test('that it returns the correct bucket name when the URL has multiple path segments', () => {
      const s3Url = 'http://username:password@localhost:9000/foo';

      const bucketName = extractS3BucketName(s3Url);

      expect(bucketName).toBe('foo');
    });
  });

  describe('isVirtualHostStyleUrl', () => {
    test('that it returns true for a virtual-hosted-style URL', () => {
      const url = new URL('https://cosmo-controlplane-bucket.s3.amazonaws.com');

      const result = isVirtualHostStyleUrl(url);

      expect(result).toBe(true);
    });

    test('that it returns false for a path-style URL', () => {
      const url = new URL('http://minio:9000/cosmo');

      const result = isVirtualHostStyleUrl(url);

      expect(result).toBe(false);
    });

    test('that it returns false for a custom domain without bucket name in the hostname', () => {
      const url = new URL('https://example.com/cosmo');

      const result = isVirtualHostStyleUrl(url);

      expect(result).toBe(false);
    });
  });
});
