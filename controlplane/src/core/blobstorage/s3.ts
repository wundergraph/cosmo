import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BlobNotFoundError, type BlobStorage } from './index.js';

/**
 * Stores objects in S3 given an S3Client and a bucket name
 */
export class S3BlobStorage implements BlobStorage {
  constructor(
    private s3Client: S3Client,
    private bucketName: string,
  ) {}

  async putObject({
    key,
    body,
    contentType,
    version,
  }: {
    key: string;
    body: Buffer;
    contentType: string;
    version?: string;
  }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: version
        ? {
            version,
          }
        : undefined,
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

  async removeDirectory(key: string): Promise<number> {
    const listCommand = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: key,
    });
    const entries = await this.s3Client.send(listCommand);
    const objectsToDelete = entries.Contents?.map((item) => ({ Key: item.Key }));
    if (objectsToDelete && objectsToDelete.length > 0) {
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: objectsToDelete,
          Quiet: false,
        },
      });
      const deleted = await this.s3Client.send(deleteCommand);
      if (deleted.Errors) {
        throw new Error(`could not delete files: ${deleted.Errors}`);
      }
    }
    return objectsToDelete?.length ?? 0;
  }
}
