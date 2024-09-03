import { describe, expect, test } from 'vitest';
import { createS3ClientConfig, extractS3BucketName, isVirtualHostStyleUrl } from '../src';

describe('S3 Utils', () => {
  describe('createS3ClientConfig', () => {
    test('correctly configures an S3 client for a path-style URL', () => {
      const bucketName = 'cosmo';
      const opts = {
        url: 'http://username:password@minio:9000/cosmo',
        region: 'auto',
        endpoint: undefined,
        username: '',
        password: '',
      };

      const config = createS3ClientConfig(bucketName, opts);

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

    test('correctly configures an S3 client for a virtual-hosted-style URL with provided endpoint', () => {
      const bucketName = 'cosmo-controlplane-bucket';
      const opts = {
        url: 'https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com',
        region: 'us-east-1',
        endpoint: 's3.amazonaws.com',
        username: '',
        password: '',
      };

      const config = createS3ClientConfig(bucketName, opts);

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

    test('correctly configures an S3 client for a virtual-hosted-style URL without provided endpoint', () => {
      const bucketName = 'cosmo-controlplane-bucket';
      const opts = {
        url: 'https://username:password@cosmo-controlplane-bucket.s3.amazonaws.com',
        region: 'us-east-1',
        endpoint: undefined,
        username: '',
        password: '',
      };

      const config = createS3ClientConfig(bucketName, opts);

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

    test('throws an AuthenticationError if credentials are missing', () => {
      const bucketName = 'cosmo-controlplane-bucket';
      const opts = {
        url: 'https://cosmo-controlplane-bucket.s3.amazonaws.com',
        region: 'us-east-1',
        endpoint: '',
        username: '',
        password: '',
      };

      expect(() => createS3ClientConfig(bucketName, opts)).toThrowError(
        'Missing S3 credentials. Please provide access key ID and secret access key.',
      );
    });

    test('correctly configures an S3 client when credentials are provided in opts', () => {
      const bucketName = 'cosmo-controlplane-bucket';
      const opts = {
        url: 'https://cosmo-controlplane-bucket.s3.amazonaws.com',
        region: 'us-east-1',
        endpoint: '',
        username: 'testUser',
        password: 'testPass',
      };

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
    });

    test('throws an error if region is missing', () => {
      const bucketName = 'cosmo-controlplane-bucket';
      const opts = {
        url: 'https://cosmo-controlplane-bucket.s3.amazonaws.com',
        region: '',
        endpoint: '',
        username: 'testUser',
        password: 'testPass',
      };

      expect(() => createS3ClientConfig(bucketName, opts)).toThrowError('Missing region in S3 configuration.');
    });
  });

  describe('extractS3BucketName', () => {
    test('returns the correct bucket name for a virtual-hosted-style URL', () => {
      const s3Url = 'https://cosmo-controlplane-bucket.s3.amazonaws.com/some/object';

      const bucketName = extractS3BucketName(s3Url);

      expect(bucketName).toBe('cosmo-controlplane-bucket');
    });

    test('returns the correct bucket name for a path-style URL', () => {
      const s3Url = 'http://minio:9000/cosmo';

      const bucketName = extractS3BucketName(s3Url);

      expect(bucketName).toBe('cosmo');
    });

    test('returns the correct bucket name when the URL has multiple path segments', () => {
      const s3Url = 'http://username:password@localhost:9000/foo';

      const bucketName = extractS3BucketName(s3Url);

      expect(bucketName).toBe('foo');
    });
  });

  describe('isVirtualHostStyleUrl', () => {
    test('returns true for a virtual-hosted-style URL', () => {
      const url = new URL('https://cosmo-controlplane-bucket.s3.amazonaws.com');

      const result = isVirtualHostStyleUrl(url);

      expect(result).toBe(true);
    });

    test('returns false for a path-style URL', () => {
      const url = new URL('http://minio:9000/cosmo');

      const result = isVirtualHostStyleUrl(url);

      expect(result).toBe(false);
    });

    test('returns false for a custom domain without bucket name in the hostname', () => {
      const url = new URL('https://example.com/cosmo');

      const result = isVirtualHostStyleUrl(url);

      expect(result).toBe(false);
    });
  });
});
