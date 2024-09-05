import { GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, S3Client } from '@aws-sdk/client-s3';
import { BlobNotFoundError, BlobObject, BlobStorage } from '@wundergraph/cosmo-cdn';
import { Context } from 'hono';
import { createS3ClientConfig, extractS3BucketName } from './utils';

/**
 * Retrieves objects from S3 given an S3Client and a bucket name
 */
class S3BlobStorage implements BlobStorage {
  constructor(
    private s3Client: S3Client,
    private bucketName: string,
  ) {}

  async getObject({
    context,
    key,
    cacheControl,
  }: {
    context: Context;
    key: string;
    cacheControl?: string;
  }): Promise<BlobObject> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ResponseCacheControl: cacheControl,
    });

    try {
      const resp = await this.s3Client.send(command);
      if (resp.$metadata.httpStatusCode !== 200) {
        throw new Error(`Failed to retrieve object from S3: ${resp}`);
      }

      if (!resp.Body) {
        throw new Error(`Failed to retrieve object from S3: ${resp}`);
      }

      return {
        metadata: resp.Metadata,
        stream: resp.Body.transformToWebStream(),
      };
    } catch (e: any) {
      if (e instanceof NoSuchKey) {
        throw new BlobNotFoundError(`Failed to retrieve object from S3: ${e}`);
      }
      throw e;
    }
  }

  async headObject({
    context,
    key,
    schemaVersionId,
  }: {
    context: Context;
    key: string;
    schemaVersionId: string;
  }): Promise<boolean> {
    const command = new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    try {
      const resp = await this.s3Client.send(command);
      if (resp.$metadata.httpStatusCode === 404) {
        throw new BlobNotFoundError(`Object not found`);
      } else if (resp.$metadata.httpStatusCode === 304) {
        return false;
      } else if (resp.$metadata.httpStatusCode !== 200) {
        throw new Error(`Failed to fetch the metadata of the object.`);
      }
      if (resp.Metadata && resp.Metadata.version === schemaVersionId) {
        return false;
      }
      return true;
    } catch (e: any) {
      if (e instanceof NoSuchKey || e instanceof NotFound) {
        throw new BlobNotFoundError(`Object not found: ${e}`);
      }
      throw e;
    }
  }
}

export const createS3BlobStorage = (storageUrl: string): BlobStorage => {
  const url = new URL(storageUrl);
  const region = url.searchParams.get('region') ?? process.env.S3_REGION ?? 'default';
  const endpoint = url.searchParams.get('endpoint') ?? process.env.S3_ENDPOINT;
  const username = process.env.S3_ACCESS_KEY_ID || '';
  const password = process.env.S3_SECRET_ACCESS_KEY || '';
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

  const opts = {
    url: storageUrl,
    region,
    endpoint,
    username,
    password,
    forcePathStyle,
  };

  const bucketName = extractS3BucketName(opts);
  const s3Config = createS3ClientConfig(bucketName, opts);
  const s3Client = new S3Client(s3Config);

  return new S3BlobStorage(s3Client, bucketName);
};
