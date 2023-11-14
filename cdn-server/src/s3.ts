import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BlobNotFoundError, BlobStorage } from '@wundergraph/cdn';
import { Context } from 'hono';

/**
 * Retrieves objects from S3 given an S3Client and a bucket name
 */
class S3BlobStorage implements BlobStorage {
  constructor(
    private s3Client: S3Client,
    private bucketName: string,
  ) {}

  async getObject(_c: Context, key: string): Promise<ReadableStream> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    const resp = await this.s3Client.send(command);
    if (resp.$metadata.httpStatusCode !== 200) {
      throw new BlobNotFoundError(`Failed to retrieve object from S3: ${resp}`);
    }
    return resp.Body!.transformToWebStream();
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
