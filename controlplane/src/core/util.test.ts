import { describe, expect, test } from 'vitest';
import { extractOperationNames, hasLabelsChanged, isValidLabels, isValidOrganizationSlug } from './util.js';

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
  test('Valid organization slug', () => {
    const slugs = [
      { slug: 'acme-corp', expected: true },
      { slug: '1acme-corp2', expected: true },
      { slug: 'ac', expected: false },
      { slug: '25CharactersLong123456789', expected: false },
      { slug: 'acme-', expected: false },
      { slug: '-acme', expected: false },
      { slug: 'ac_24', expected: false },
      { slug: '1a$c', expected: false },
    ];

    for (const entry of slugs) {
      expect(isValidOrganizationSlug(entry.slug)).equal(entry.expected);
    }
  });
});

describe('extract operation names', () => {
  test('parse operations without names', () => {
    const contents = `query {
          hello
      }`;
    const operationNames = extractOperationNames(contents);
    expect(operationNames).toEqual([]);
  });
  test('parse operations with names', () => {
    const contents = `query getTaskAndUser {
          getTask(id: "0x3") {
            id
            title
            completed
          }
          queryUser(filter: {username: {eq: "john"}}) {
            username
            name
          }
        }
        
        query completedTasks {
          queryTask(filter: {completed: true}) {
            title
            completed
          }
        }
      `;

    const operationNames = extractOperationNames(contents);
    expect(operationNames).toEqual(['getTaskAndUser', 'completedTasks']);
  });
});
