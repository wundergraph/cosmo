import { describe, expect, test } from 'vitest';
import { summarizeTiming, suggestDefers } from '../src/components/playground/defer-advisor/analysis';

describe('summarizeTiming', () => {
  const latencies = { pricing: 13, reviews: 605, recommendations: 907 };

  test('total is the slowest field, since root fields run in parallel', () => {
    const timing = summarizeTiming(latencies, []);

    expect(timing.totalMs).toBe(907);
  });

  test('with nothing deferred, TTFB does not change', () => {
    const timing = summarizeTiming(latencies, []);

    expect(timing.ttfbAfterMs).toBe(timing.totalMs);
  });

  test('deferring the slowest fields leaves the slowest immediate field as TTFB', () => {
    const timing = summarizeTiming(latencies, ['recommendations', 'reviews']);

    expect(timing.ttfbAfterMs).toBe(13);
    expect(timing.totalMs).toBe(907);
  });
});

describe('suggestDefers', () => {
  test('suggests fields above the hard floor', () => {
    const names = suggestDefers({ pricing: 13, reviews: 605, recommendations: 907 }).map((s) => s.fieldName);

    expect(names).toEqual(['recommendations', 'reviews']);
  });

  test('suggests every field slower than the fastest, so applying all of them leaves the fastest as TTFB', () => {
    const latencies = { pricing: 13, reviews: 605, recommendations: 907 };
    const suggested = suggestDefers(latencies).map((s) => s.fieldName);

    const timing = summarizeTiming(latencies, suggested);
    expect(timing.ttfbAfterMs).toBe(13);
  });

  test('suggests nothing when every field is equally fast', () => {
    expect(suggestDefers({ a: 50, b: 50 })).toEqual([]);
  });
});
