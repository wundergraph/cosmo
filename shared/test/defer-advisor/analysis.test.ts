import { describe, expect, test } from 'vitest';
import { slowFieldNames } from '../../src/defer-advisor/analysis.js';

describe('slowFieldNames', () => {
  test('flags fields above the fastest one', () => {
    expect(slowFieldNames({ pricing: 13, reviews: 605, recommendations: 907 })).toEqual(
      new Set(['reviews', 'recommendations']),
    );
  });

  test('flags nothing when every field is equally fast', () => {
    expect(slowFieldNames({ a: 50, b: 50 })).toEqual(new Set());
  });

  test('flags nothing when there are no measurements', () => {
    expect(slowFieldNames({})).toEqual(new Set());
  });
});
