import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  isValidLabelMatchers,
  mergeUrls,
  normalizeLabelMatchers,
  isGoogleCloudStorageUrl,
  runLocking
} from '../src/core/util.js';
import { deferred, expectPending } from "./test-util.js";

describe('Utils', () => {
  test('isValidLabelMatchers', () => {
    expect(isValidLabelMatchers(['key1=value1'])).toBe(true);
    expect(isValidLabelMatchers(['key1=value1,key2=value2'])).toBe(true);
    expect(isValidLabelMatchers(['key1=value1,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1=value 1,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1=value.1,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1=,key2='])).toBe(false);
    expect(isValidLabelMatchers(['key1'])).toBe(false);
    expect(isValidLabelMatchers(['key1='])).toBe(false);
  });

  test('normalizeLabelMatchers', () => {
    expect(normalizeLabelMatchers(['A=value,A=value', 'B=value'])).toEqual(['A=value', 'B=value']);
    expect(normalizeLabelMatchers(['A=value2,B=value', 'B=value'])).toEqual(['A=value2,B=value', 'B=value']);
    expect(normalizeLabelMatchers(['A=value,B=value', 'A=value,B=value'])).toEqual(['A=value,B=value']);
  });

  test('mergeURLS', () => {
    expect(mergeUrls('http://example.com', 'path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com', '/path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com/', 'path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com/', '/path')).toBe('http://example.com/path');
    expect(mergeUrls('http://example.com/auth', 'path')).toBe('http://example.com/auth/path');
    expect(mergeUrls('http://example.com/auth/', 'path')).toBe('http://example.com/auth/path');
    expect(mergeUrls('http://example.com/auth', '/path')).toBe('http://example.com/auth/path');
    expect(mergeUrls('http://example.com/auth/', '/path')).toBe('http://example.com/auth/path');
  });

  describe('isGoogleCloudStorageUrl', () => {
    test('that true is returned when a valid Google Cloud Storage URL', () => {
      expect(isGoogleCloudStorageUrl('https://storage.googleapis.com/')).toBe(true);
      expect(isGoogleCloudStorageUrl('https://STORAGE.GOOGLEAPIS.COM')).toBe(true);
      expect(isGoogleCloudStorageUrl('https://storage.googleapis.com/bucket-name')).toBe(true);
      expect(isGoogleCloudStorageUrl('https://bucket-name.storage.googleapis.com/')).toBe(true);
    });

    test('that true is returned when an URL with the `gs` protocol', () => {
      expect(isGoogleCloudStorageUrl('gs://bucket-name')).toBe(true);
    });

    test('that false is returned when the URL is not a valid Google Cloud Storage URL', () => {
      expect(isGoogleCloudStorageUrl('http://minio/cosmo')).toBe(false);
      expect(isGoogleCloudStorageUrl('https://bucket-name.s3.amazonaws.com/')).toBe(false);
      expect(isGoogleCloudStorageUrl('https://bucket-name.s3.amazonaws.com')).toBe(false);
      expect(isGoogleCloudStorageUrl('https://storage.googleapis.com.evil.com')).toBe(false);
    });
  });

  describe('runLocking', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test('that single call returns without locking', async () => {
      const result = await runLocking('test', () => Promise.resolve('hello world'));
      expect(result).toBe('hello world');
    });

    test('coalesces concurrent calls for the SAME key', async () => {
      const gate = deferred<void>();

      const worker = vi.fn(async () => {
        await gate.promise; // hold until we release the gate
        return "OK";
      });

      // Start two concurrent calls with the same key
      const p1 = runLocking("user:42", worker);
      const p2 = runLocking("user:42", worker);

      // Both callers must share the exact same Promise
      expect(p1).toBe(p2);

      // Underlying work should have started only once
      expect(worker).toHaveBeenCalledTimes(1);

      // Let it finish and verify both callers get the same result
      gate.resolve();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("OK");
      expect(r2).toBe("OK");
    });

    test('does NOT lock across DIFFERENT keys (independent execution)', async () => {
      const gateA = deferred<void>();
      const gateB = deferred<void>();

      const worker = vi.fn(async (val: string, gate: ReturnType<typeof deferred<void>>) => {
        await gate.promise;
        return val;
      });

      const pA = runLocking("user:A", () => worker("A", gateA));
      const pB = runLocking("user:B", () => worker("B", gateB));

      // Different keys should produce different Promises and start separate work
      expect(pA).not.toBe(pB);
      expect(worker).toHaveBeenCalledTimes(2);

      // Resolve B first; A should still be pending
      gateB.resolve();

      const rB = await pB;
      expect(rB).toBe("B");

      const p = expectPending(pA); // A hasn't been released yet
      await vi.advanceTimersByTimeAsync(100);

      await p;

      // Now resolve A
      gateA.resolve();
      const rA = await pA;
      expect(rA).toBe("A");
    })
  });

  test('starts fresh after a call completes (entry cleanup)', async () => {
    // One worker whose gate we can swap between runs
    let gate = deferred<void>();
    const worker = vi.fn(async () => {
      await gate.promise;
      return "done";
    });

    // First run
    const p1 = runLocking("user:99", worker);
    gate.resolve();
    await p1;

    // Swap to a new gate and call again — should start a NEW underlying run
    gate = deferred<void>();

    const p2 = runLocking("user:99", worker);
    expect(p2).not.toBe(p1); // new promise after cleanup
    expect(worker).toHaveBeenCalledTimes(2);

    gate.resolve();
    await p2;
  })
});
