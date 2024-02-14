import { describe, expect, test } from 'vitest';
import { areValidLabelMatchers, normalizeLabelMatchers } from '../src/core/util.js';

describe('Utils', () => {
  test('isValidLabelMatchers', () => {
    expect(areValidLabelMatchers(['key1=value1'])).toBe(true);
    expect(areValidLabelMatchers(['key1=value1,key2=value2'])).toBe(true);
    expect(areValidLabelMatchers(['key1=value1,key2='])).toBe(false);
    expect(areValidLabelMatchers(['key1=,key2='])).toBe(false);
    expect(areValidLabelMatchers(['key1'])).toBe(false);
    expect(areValidLabelMatchers(['key1='])).toBe(false);
  });

  test('normalizeLabelMatchers', () => {
    expect(normalizeLabelMatchers(['A=value,A=value', 'B=value'])).toEqual(['A=value', 'B=value']);
    expect(normalizeLabelMatchers(['A=value2,B=value', 'B=value'])).toEqual(['A=value2,B=value', 'B=value']);
    expect(normalizeLabelMatchers(['A=value,B=value', 'A=value,B=value'])).toEqual(['A=value,B=value']);
  });
});
