export { S3BlobStorage } from './s3.js';

export class BlobNotFoundError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    Object.setPrototypeOf(this, BlobNotFoundError.prototype);
  }
}

export interface BlobObject {
  metadata?: Record<string, string>;
  stream: ReadableStream;
}

/**
 * Describes the interface for a blob storage service
 */
export interface BlobStorage {
  /**
   * Stores an object in the blob storage under the given key, throwing an error if the operation fails
   * @param key Key to store the object under
   * @param body Buffer containing the object to store
   * @param contentType Content type of the object
   * @param metadata Optional metadata to store with the object
   */
  putObject<Metadata extends Record<string, string>>({
    key,
    body,
    contentType,
    metadata,
  }: {
    key: string;
    abortSignal?: AbortSignal;
    body: Buffer;
    contentType: string;
    metadata?: Metadata;
  }): Promise<void>;
  /**
   * Retrieves an object from the blob storage using the given key. If the blob doesn't exist, it throws
   * BlobNotFoundError.
   */
  getObject(data: { key: string; abortSignal?: AbortSignal }): Promise<BlobObject>;

  /**
   * Remove a directory recursively, erasing all entries under the given key
   */
  removeDirectory(data: { key: string; abortSignal?: AbortSignal }): Promise<number>;

  /**
   * Remove an object from the blob storage using the given key
   */
  deleteObject(data: { key: string; abortSignal?: AbortSignal }): Promise<void>;
}
