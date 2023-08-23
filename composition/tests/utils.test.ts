import { EntityKey, getEntityKeyExtractionResult } from '../src';
import { describe, expect, test } from 'vitest';

describe('Utils tests', () => {
  test('that an entity key is extracted successfully', () => {
    const expectedEntityKey: EntityKey = {
      parent: '',
      siblings: ['name'],
    };
    const { entityKey } = getEntityKeyExtractionResult('name', '');
    expect(entityKey).toStrictEqual(expectedEntityKey);
  });

  test('that an entity key with nesting is extracted successfully', () => {
    const expectedEntityKey: EntityKey = {
      parent: '',
      siblings: ['organization'],
      nestedKeys: [
        {
          parent: 'organization',
          siblings: ['id'],
        },
      ],
    };
    const { entityKey } = getEntityKeyExtractionResult('organization { id }', '');
    expect(entityKey).toStrictEqual(expectedEntityKey);
  });

  test('that a composite entity key with nesting is extracted successfully', () => {
    const expectedEntityKey: EntityKey = {
      parent: '',
      siblings: ['id', 'organization'],
      nestedKeys: [
        {
          parent: 'organization',
          siblings: ['id'],
        },
      ],
    };
    const { entityKey } = getEntityKeyExtractionResult('id organization { id }', '');
    expect(entityKey).toStrictEqual(expectedEntityKey);
  });

  test('that a composite entity key with nested siblings is extracted successfully', () => {
    const expectedEntityKey: EntityKey = {
      parent: '',
      siblings: ['id', 'organization'],
      nestedKeys: [
        {
          parent: 'organization',
          siblings: ['details', 'name'],
        },
      ],
    };
    const { entityKey } = getEntityKeyExtractionResult('id organization { details name }', '');
    expect(entityKey).toStrictEqual(expectedEntityKey);
  });

  test('that a composite entity key with deep nesting and nested siblings is extracted successfully', () => {
    const expectedEntityKey: EntityKey = {
      parent: '',
      siblings: ['id', 'organization'],
      nestedKeys: [
        {
          parent: 'organization',
          siblings: ['details', 'name'],
          nestedKeys: [
            {
              parent: 'details',
              siblings: ['id'],
            },
          ],
        },
      ],
    };
    const { entityKey } = getEntityKeyExtractionResult('id organization { details { id } name }', '');
    expect(entityKey).toStrictEqual(expectedEntityKey);
  });

  test('that a composite entity key with deep nesting and nested siblings that also have nesting is extracted successfully', () => {
    const expectedEntityKey: EntityKey = {
      parent: '',
      siblings: ['id', 'organization'],
      nestedKeys: [
        {
          parent: 'organization',
          siblings: ['details', 'team'],
          nestedKeys: [
            {
              parent: 'details',
              siblings: ['id'],
            },
            {
              parent: 'team',
              siblings: ['names'],
              nestedKeys: [
                {
                  parent: 'names',
                  siblings: ['forename'],
                },
              ],
            },
          ],
        },
      ],
    };
    const { entityKey } = getEntityKeyExtractionResult(
      'id organization { details { id } team { names { forename } } }',
      'Entity',
    );
    expect(entityKey).toStrictEqual(expectedEntityKey);
  });
});
