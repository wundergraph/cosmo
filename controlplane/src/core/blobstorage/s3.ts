import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BlobNotFoundError, BlobObject, type BlobStorage } from './index.js';

const maxConcurrency = 10; // Maximum number of concurrent operations

/**
 * Configuration options for S3BlobStorage
 */
export interface S3BlobStorageConfig {
  /**
   * Use individual delete operations instead of bulk delete.
   * Set to true for GCS compatibility, false for better S3 performance.
   * @default false
   */
  useIndividualDeletes?: boolean;
}

/**
 * Stores objects in S3 given an S3Client and a bucket name
 */
export class S3BlobStorage implements BlobStorage {
  private readonly useIndividualDeletes: boolean;

  constructor(
    private s3Client: S3Client,
    private bucketName: string,
    config: S3BlobStorageConfig = {},
  ) {
    this.useIndividualDeletes = config.useIndividualDeletes ?? false;
  }

  /**
   * Execute promises with limited concurrency and delays between batches
   * Retries are handled by AWS SDK internally using exponential backoff. Default 3 retries.
   */
  private async executeWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map((task) => task()));
      results.push(...batchResults);
    }

    return results;
  }

  async putObject<Metadata extends Record<string, string>>({
    key,
    body,
    contentType,
    metadata,
  }: {
    key: string;
    body: Buffer;
    contentType: string;
    version?: string;
    metadata?: Metadata;
  }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    });
    const resp = await this.s3Client.send(command);
    if (resp.$metadata.httpStatusCode !== 200) {
      throw new Error(`Failed to put object to S3: ${resp}`);
    }
  }

  async deleteObject(data: { key: string; abortSignal?: AbortSignal }): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: data.key,
    });

    const resp = await this.s3Client.send(command, {
      abortSignal: data.abortSignal,
    });

    if (resp.$metadata.httpStatusCode !== 204) {
      throw new Error(`Failed to delete object from S3: ${resp}`);
    }
  }

  async getObject(data: { key: string; abortSignal?: AbortSignal }): Promise<BlobObject> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: data.key,
    });
    try {
      const resp = await this.s3Client.send(command, {
        abortSignal: data.abortSignal,
      });

      if (resp.$metadata.httpStatusCode !== 200) {
        throw new Error(`Failed to retrieve object from S3: ${resp}`);
      }

      if (!resp.Body) {
        throw new Error(`Failed to retrieve object from S3: ${resp}`);
      }

      return {
        stream: resp.Body.transformToWebStream(),
        metadata: resp.Metadata,
      };
    } catch (e: any) {
      if (e instanceof NoSuchKey) {
        throw new BlobNotFoundError(`Failed to retrieve object from S3: ${e}`);
      }
      throw e;
    }
  }

  /**
   * Delete objects using bulk DeleteObjectsCommand (efficient for S3)
   */
  private async deleteObjectsBulk(objects: { Key?: string }[], abortSignal?: AbortSignal): Promise<number> {
    const objectsToDelete = objects.filter((item) => item.Key).map((item) => ({ Key: item.Key! }));

    if (objectsToDelete.length === 0) {
      return 0;
    }

    const deleteCommand = new DeleteObjectsCommand({
      Bucket: this.bucketName,
      Delete: {
        Objects: objectsToDelete,
        Quiet: false,
      },
    });

    const deleted = await this.s3Client.send(deleteCommand, { abortSignal });

    if (deleted.Errors && deleted.Errors.length > 0) {
      throw new Error(`Could not delete files: ${JSON.stringify(deleted.Errors)}`);
    }

    return deleted.Deleted?.length ?? 0;
  }

  /**
   * Delete objects individually with limited concurrency (for GCS compatibility)
   */
  private async deleteObjectsIndividually(objects: { Key?: string }[], abortSignal?: AbortSignal): Promise<number> {
    const deleteTasks = objects.map((item) => async () => {
      if (item.Key) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: item.Key,
        });
        await this.s3Client.send(deleteCommand, { abortSignal });
        return 1;
      }
      return 0;
    });

    const deletedCounts = await this.executeWithConcurrency(deleteTasks, maxConcurrency);
    return deletedCounts.reduce((sum: number, count: number) => sum + count, 0);
  }

  async removeDirectory(data: { key: string; abortSignal?: AbortSignal }): Promise<number> {
    let totalDeleted = 0;
    let continuationToken: string | undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: data.key,
        ContinuationToken: continuationToken,
      });

      const entries = await this.s3Client.send(listCommand, {
        abortSignal: data.abortSignal,
      });

      if (entries.Contents && entries.Contents.length > 0) {
        if (this.useIndividualDeletes) {
          // Use individual deletes for S3 implementation without DeleteObjectsCommand
          totalDeleted += await this.deleteObjectsIndividually(entries.Contents, data.abortSignal);
        } else {
          // Use bulk delete for better S3 performance
          totalDeleted += await this.deleteObjectsBulk(entries.Contents, data.abortSignal);
        }
      }

      continuationToken = entries.IsTruncated ? entries.NextContinuationToken : undefined;
    } while (continuationToken);

    return totalDeleted;
  }
}
