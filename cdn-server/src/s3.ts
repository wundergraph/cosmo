import { GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, S3Client } from '@aws-sdk/client-s3';
import { BlobNotFoundError, BlobObject, BlobStorage } from '@wundergraph/cosmo-cdn';
import { Context } from 'hono';

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
  const region = url.searchParams.get('region') ?? 'default';
  const s3Client = new S3Client({
    region,
    endpoint: url.origin,
    credentials: {
      accessKeyId: url.username ?? '',
      secretAccessKey: url.password ?? '',
    },
    forcePathStyle: true,
  });
  const bucketName = url.pathname.slice(1);
  return new S3BlobStorage(s3Client, bucketName);
};
