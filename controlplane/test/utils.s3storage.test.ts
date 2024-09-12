import { describe, expect, test } from 'vitest';
import { createS3ClientConfig, extractS3BucketName, isVirtualHostStyleUrl } from '../src/core/util.js';

describe('S3 Utils', () => {
  describe('createS3ClientConfig with forced path style', () => {
    test('that it correctly configures an S3 client for a path-style URL', () => {
      const opts = {
        url: 'https://cosmo-controlplane-bucket.provider.com/cosmo',
        region: 'us-east-1',
        endpoint: '',
        username: 'testUser',
        password: 'testPass',
        forcePathStyle: true,
      };

      const bucketName = extractS3BucketName(opts);
      const config = createS3ClientConfig(bucketName, opts);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 'https://cosmo-controlplane-bucket.provider.com',
        credentials: {
          accessKeyId: 'testUser',
          secretAccessKey: 'testPass',
        },
        forcePathStyle: true,
      });
      expect(bucketName).toBe('cosmo');
    });

    test('that it correctly configures an S3 client for a path-style URL when an endpoint is set', () => {
      const opts = {
        url: 'https://cosmo-controlplane-bucket.provider.com/cosmo',
        region: 'us-east-1',
        endpoint: 'custom-endpoint.com',
        username: 'testUser',
        password: 'testPass',
        forcePathStyle: true,
      };

      const bucketName = extractS3BucketName(opts);
      const config = createS3ClientConfig(bucketName, opts);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 'custom-endpoint.com',
        credentials: {
          accessKeyId: 'testUser',
          secretAccessKey: 'testPass',
        },
        forcePathStyle: true,
      });
      expect(bucketName).toBe('cosmo');
    });

    test('that it correctly configures an S3 client for a path-style URL which also has virtual hosts', () => {
      const opts = {
        url: 'https://username:password@xxxxxxxxxxxxxxxxxxx.r2.cloudflarestorage.com/cosmo-cdn',
        region: 'us-east-1',
        endpoint: '',
        forcePathStyle: true,
      };

      const bucketName = extractS3BucketName(opts);
      const config = createS3ClientConfig(bucketName, opts);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 'https://xxxxxxxxxxxxxxxxxxx.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: 'username',
          secretAccessKey: 'password',
        },
        forcePathStyle: true,
      });
      expect(bucketName).toBe('cosmo-cdn');
    });
  });

  describe('createS3ClientConfig without forced path style', () => {
    test('that it correctly configures an S3 client for a virtual-hosted-style URL', () => {
      const opts = {
        url: 'https://cosmo-controlplane-bucket.s3.amazonaws.com/cosmo',
        region: 'us-east-1',
        endpoint: '',
        username: 'testUser',
        password: 'testPass',
        forcePathStyle: false,
      };

      const bucketName = extractS3BucketName(opts);
      const config = createS3ClientConfig(bucketName, opts);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 'https://s3.amazonaws.com',
        credentials: {
          accessKeyId: 'testUser',
          secretAccessKey: 'testPass',
        },
        forcePathStyle: false,
      });
      expect(bucketName).toBe('cosmo-controlplane-bucket');
    });

    test('that it correctly configures an S3 client for a virtual-hosted-style URL with a custom endpoint', () => {
      const opts = {
        url: 'https://cosmo-controlplane-bucket.s3.amazonaws.com/cosmo',
        region: 'us-east-1',
        endpoint: 's3.amazonaws.com',
        username: 'testUser',
        password: 'testPass',
        forcePathStyle: false,
      };

      const bucketName = extractS3BucketName(opts);
      const config = createS3ClientConfig(bucketName, opts);

      expect(config).toEqual({
        region: 'us-east-1',
        endpoint: 's3.amazonaws.com',
        credentials: {
          accessKeyId: 'testUser',
          secretAccessKey: 'testPass',
        },
        forcePathStyle: false,
      });
      expect(bucketName).toBe('cosmo-controlplane-bucket');
    });

    test('that it correctly configures an S3 client with multiple subdomains path styled', () => {
      const opts = {
        url: 'https://minio.east.domain.com/mybucket',
        region: 'auto',
        endpoint: '',
        username: 'testUser',
        password: 'testPass',
        forcePathStyle: true,
      };

      const bucketName = extractS3BucketName(opts);
      const config = createS3ClientConfig(bucketName, opts);

      expect(config).toEqual({
        region: 'auto',
        endpoint: 'https://minio.east.domain.com',
        credentials: {
          accessKeyId: 'testUser',
          secretAccessKey: 'testPass',
        },
        forcePathStyle: true,
      });
      expect(bucketName).toBe('mybucket');
    });
  });

  describe('isVirtualHostStyleUrl tests', () => {
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

  describe('extractS3BucketName tests', () => {
    test('that it returns the correct bucket name for a virtual-hosted-style URL', () => {
      const opts = { url: 'https://cosmo-controlplane-bucket.s3.amazonaws.com/some/object' };

      const bucketName = extractS3BucketName(opts);

      expect(bucketName).toBe('cosmo-controlplane-bucket');
    });

    test('that it returns the correct bucket name for a path-style URL', () => {
      const opts = { url: 'http://minio:9000/cosmo' };

      const bucketName = extractS3BucketName(opts);

      expect(bucketName).toBe('cosmo');
    });

    test('that it returns the correct bucket name when the URL has multiple path segments', () => {
      const opts = { url: 'http://username:password@localhost:9000/foo' };

      const bucketName = extractS3BucketName(opts);

      expect(bucketName).toBe('foo');
    });
  });
});
