export { S3BlobStorage } from './s3.js';

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
}

export class NoBlobStorage implements BlobStorage {
  putObject(key: string, body: Buffer): Promise<void> {
    throw new Error('No blob storage configured');
  }
}
