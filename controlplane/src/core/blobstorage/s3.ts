import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BlobNotFoundError, type BlobStorage } from './index.js';

/**
 * Stores objects in S3 given an S3Client and a bucket name
 */
export class S3BlobStorage implements BlobStorage {
  constructor(
    private s3Client: S3Client,
    private bucketName: string,
  ) {}

  async putObject(key: string, body: Buffer): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
    });
    const resp = await this.s3Client.send(command);
    if (resp.$metadata.httpStatusCode !== 200) {
      throw new Error(`Failed to put object to S3: ${resp}`);
    }
  }

  async getObject(key: string): Promise<ReadableStream> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    try {
      const resp = await this.s3Client.send(command);
      if (resp.$metadata.httpStatusCode !== 200) {
        throw new BlobNotFoundError(`Failed to retrieve object from S3: ${resp}`);
      }
      return resp.Body!.transformToWebStream();
    } catch (e: any) {
      if (e instanceof NoSuchKey) {
        throw new BlobNotFoundError(`Failed to retrieve object from S3: ${e}`);
      }
      throw e;
    }
  }
}
