import { describe, expect, test } from 'vitest';
import { computeFieldPills } from '../src/components/playground/defer-advisor/defer-pills';

describe('computeFieldPills', () => {
  const query = '{\n  reviews {\n    text\n  }\n  pricing\n}';
  const latencies = { reviews: 480, pricing: 90 };

  test('places a pill right after each field name', () => {
    const pills = computeFieldPills(query, latencies);
    const reviews = pills.find((p) => p.fieldName === 'reviews');

    expect(reviews?.offset).toBe(query.indexOf('reviews') + 'reviews'.length);
    expect(query.slice(0, reviews!.offset).endsWith('reviews')).toBe(true);
  });

  test('marks only the fields slower than the fastest as slow', () => {
    const pills = computeFieldPills(query, latencies);

    expect(pills.map((p) => [p.fieldName, p.slow])).toEqual([
      ['reviews', true],
      ['pricing', false],
    ]);
  });

  test('gives no pill to nested fields, even when a root field has the same name', () => {
    const nested = '{ pricing { reviews } }';
    const pills = computeFieldPills(nested, { pricing: 90, reviews: 600 });

    expect(pills.map((p) => p.fieldName)).toEqual(['pricing']);
  });

  test('uses the alias as the response key', () => {
    const aliased = '{ topReviews: reviews { text } }';
    const pills = computeFieldPills(aliased, { topReviews: 500, pricing: 90 });

    expect(pills).toHaveLength(1);
    expect(pills[0]?.fieldName).toBe('topReviews');
    expect(pills[0]?.slow).toBe(true);
  });

  test('skips fields without a probe result', () => {
    const pills = computeFieldPills('{ pricing unknownField }', { pricing: 90 });

    expect(pills.map((p) => p.fieldName)).toEqual(['pricing']);
  });
});
