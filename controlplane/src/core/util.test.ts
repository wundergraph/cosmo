import { describe, expect, test } from 'vitest';
import { hasLabelsChanged } from './util.js';

describe('SubgraphRepository', (ctx) => {
  test('Should identify if labels has changed', () => {
    expect(
      hasLabelsChanged(
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(false);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1' },
        ],
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(false);
    expect(
      hasLabelsChanged(
        [
          { key: 'key3', value: 'val3' },
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1' },
          { key: 'key3', value: 'val3' },
        ],
      ),
    ).toBe(false);

    expect(
      hasLabelsChanged(
        [
          { key: 'key1', value: 'val1234' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key2', value: 'val2' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1234' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key2', value: 'val1' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key123', value: 'val1' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key2', value: 'val2' },
          { key: 'key1', value: 'val1234' },
        ],
        [
          { key: 'key2', value: 'val2' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
        [{ key: 'key2', value: 'val2' }],
      ),
    ).toBe(true);
    expect(
      hasLabelsChanged(
        [],
        [
          { key: 'key1', value: 'val1' },
          { key: 'key2', value: 'val2' },
        ],
      ),
    ).toBe(true);
  });
});
