import { describe, expect, test } from 'vitest';
import { hasLabelsChanged, isValidLabels } from './util.js';

describe('Util', (ctx) => {
  test('Should validate label', () => {
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: 'val1',
        },
      ]),
    ).toBe(true);
    expect(
      isValidLabels([
        {
          key: '',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: '',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1,',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: 'val1,',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1*',
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'a'.repeat(64),
          value: 'val1',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: 'a'.repeat(64),
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: '-key1',
          value: 'val1,',
        },
      ]),
    ).toBe(false);
    expect(
      isValidLabels([
        {
          key: 'key1',
          value: '-val1,',
        },
      ]),
    ).toBe(false);
  });
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
