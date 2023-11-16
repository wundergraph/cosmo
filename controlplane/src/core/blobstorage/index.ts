export { S3BlobStorage } from './s3.js';

export class BlobNotFoundError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    Object.setPrototypeOf(this, BlobNotFoundError.prototype);
  }
}

/**
 * Describes the interface for a blob storage service
 */
export interface BlobStorage {
  /**
   * Stores an object in the blob storage under the given key, throwing an error if the operation fails
   * @param key Key to store the object under
   * @param body Data to store into the object
   */
  putObject(key: string, body: Buffer): Promise<void>;
  /**
   * Retrieves an object from the blob storage using the given key. If the blob doesn't exist, it throws
   * BlobNotFoundError.
   * @param key Key to retrieve the object from
   */
  getObject(key: string): Promise<ReadableStream>;
}
