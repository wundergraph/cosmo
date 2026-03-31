import { describe, expect, test, vi } from 'vitest';
import { DualBlobStorage } from '../src/core/blobstorage/dual.js';
import type { BlobObject, BlobStorage } from '../src/core/blobstorage/index.js';

function createMockBlobStorage(overrides?: Partial<BlobStorage>): BlobStorage {
  return {
    putObject: vi.fn().mockResolvedValue(undefined),
    getObject: vi.fn().mockResolvedValue({ stream: new ReadableStream(), metadata: {} }),
    removeDirectory: vi.fn().mockResolvedValue(5),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('DualBlobStorage', () => {
  describe('putObject', () => {
    test('calls both primary and secondary', async () => {
      const primary = createMockBlobStorage();
      const secondary = createMockBlobStorage();
      const dual = new DualBlobStorage(primary, secondary);

      const data = { key: 'test-key', body: Buffer.from('data'), contentType: 'text/plain' };
      await dual.putObject(data);

      expect(primary.putObject).toHaveBeenCalledWith(data);
      expect(secondary.putObject).toHaveBeenCalledWith(data);
    });

    test('rejects when primary fails', async () => {
      const primary = createMockBlobStorage({
        putObject: vi.fn().mockRejectedValue(new Error('primary write failed')),
      });
      const secondary = createMockBlobStorage();
      const dual = new DualBlobStorage(primary, secondary);

      await expect(dual.putObject({ key: 'k', body: Buffer.from('d'), contentType: 'text/plain' })).rejects.toThrow(
        'primary write failed',
      );
    });

    test('rejects when secondary fails', async () => {
      const primary = createMockBlobStorage();
      const secondary = createMockBlobStorage({
        putObject: vi.fn().mockRejectedValue(new Error('secondary write failed')),
      });
      const dual = new DualBlobStorage(primary, secondary);

      await expect(dual.putObject({ key: 'k', body: Buffer.from('d'), contentType: 'text/plain' })).rejects.toThrow(
        'secondary write failed',
      );
    });
  });

  describe('getObject', () => {
    test('returns primary result when primary succeeds', async () => {
      const primaryResult: BlobObject = { stream: new ReadableStream(), metadata: { source: 'primary' } };
      const primary = createMockBlobStorage({
        getObject: vi.fn().mockResolvedValue(primaryResult),
      });
      const secondary = createMockBlobStorage({
        getObject: vi.fn().mockRejectedValue(new Error('secondary read failed')),
      });
      const dual = new DualBlobStorage(primary, secondary);

      const result = await dual.getObject({ key: 'k' });

      expect(result).toBe(primaryResult);
    });

    test('falls back to secondary when primary fails', async () => {
      const secondaryResult: BlobObject = { stream: new ReadableStream(), metadata: { source: 'secondary' } };
      const primary = createMockBlobStorage({
        getObject: vi.fn().mockRejectedValue(new Error('primary read failed')),
      });
      const secondary = createMockBlobStorage({
        getObject: vi.fn().mockResolvedValue(secondaryResult),
      });
      const dual = new DualBlobStorage(primary, secondary);

      const result = await dual.getObject({ key: 'k' });

      expect(result).toBe(secondaryResult);
    });

    test('throws all promises rejected error when both fail', async () => {
      const primary = createMockBlobStorage({
        getObject: vi.fn().mockRejectedValue(new Error('primary read failed')),
      });
      const secondary = createMockBlobStorage({
        getObject: vi.fn().mockRejectedValue(new Error('secondary read failed')),
      });
      const dual = new DualBlobStorage(primary, secondary);

      await expect(dual.getObject({ key: 'k' })).rejects.toThrow('All promises were rejected');
    });
  });

  describe('deleteObject', () => {
    test('calls both primary and secondary', async () => {
      const primary = createMockBlobStorage();
      const secondary = createMockBlobStorage();
      const dual = new DualBlobStorage(primary, secondary);

      await dual.deleteObject({ key: 'k' });

      expect(primary.deleteObject).toHaveBeenCalledWith({ key: 'k' });
      expect(secondary.deleteObject).toHaveBeenCalledWith({ key: 'k' });
    });

    test('rejects when one fails', async () => {
      const primary = createMockBlobStorage({
        deleteObject: vi.fn().mockRejectedValue(new Error('delete failed')),
      });
      const secondary = createMockBlobStorage();
      const dual = new DualBlobStorage(primary, secondary);

      await expect(dual.deleteObject({ key: 'k' })).rejects.toThrow('delete failed');
    });
  });

  describe('removeDirectory', () => {
    test('returns primary count when both succeed', async () => {
      const primary = createMockBlobStorage({
        removeDirectory: vi.fn().mockResolvedValue(10),
      });
      const secondary = createMockBlobStorage({
        removeDirectory: vi.fn().mockResolvedValue(10),
      });
      const dual = new DualBlobStorage(primary, secondary);

      const count = await dual.removeDirectory({ key: 'dir/' });

      expect(count).toBe(10);
      expect(primary.removeDirectory).toHaveBeenCalledWith({ key: 'dir/' });
      expect(secondary.removeDirectory).toHaveBeenCalledWith({ key: 'dir/' });
    });

    test('rejects when one fails', async () => {
      const primary = createMockBlobStorage();
      const secondary = createMockBlobStorage({
        removeDirectory: vi.fn().mockRejectedValue(new Error('remove failed')),
      });
      const dual = new DualBlobStorage(primary, secondary);

      await expect(dual.removeDirectory({ key: 'dir/' })).rejects.toThrow('remove failed');
    });
  });
});
