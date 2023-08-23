import {
  federateSubgraphs,
  incompatibleArgumentDefaultValueError,
  incompatibleArgumentDefaultValueTypeError,
  incompatibleArgumentTypesError,
  Subgraph,
} from '../src';
import { Kind, parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { documentNodeToNormalizedString, normalizeString, versionTwoBaseSchema } from './utils/utils';

describe('Argument federation tests', () => {
  const argName = 'input';
  const parentName = 'Object';
  const childName = 'field';

  test('that equal arguments merge', () => {
    const result = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'String'),
      subgraphWithArgument('subgraph-b', 'String'),
    ]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `type Object {
        field(input: String): String
      }
    `,
      ),
    );
  });

  test('that arguments merge into their most restrictive form #1', () => {
    const result = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'Float!'),
      subgraphWithArgument('subgraph-b', 'Float'),
    ]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `type Object {
        field(input: Float!): String
      }
    `,
      ),
    );
  });

  test('that if not all arguments have a default value, the default value is ignored', () => {
    const result = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'Int'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Int', '1337'),
    ]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `type Object {
        field(input: Int): String
      }
    `,
      ),
    );
  });

  test('that if all arguments have the same default value, the default value is included', () => {
    const result = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'false'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(result.errors).toBeUndefined();
    const federatedGraph = result.federatedGraphAST!;
    expect(documentNodeToNormalizedString(federatedGraph)).toBe(
      normalizeString(
        versionTwoBaseSchema +
          `type Object {
        field(input: Boolean = false): String
      }
    `,
      ),
    );
  });

  test('that if arguments of the same name are not the same type, an error is returned`', () => {
    const result = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'String'),
      subgraphWithArgument('subgraph-b', 'Float'),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).deep.equal(
      incompatibleArgumentTypesError(argName, parentName, childName, 'String', 'Float'),
    );
  });

  test('that if arguments have different string-converted default values, an error is returned`', () => {
    const expectedType = '1';
    const actualType = '2';
    const result = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Int', expectedType),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Int', actualType),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).deep.equal(
      incompatibleArgumentDefaultValueError(argName, parentName, childName, expectedType, actualType),
    );
  });

  test('that if arguments have different boolean default values, an error is returned`', () => {
    const result = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'true'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).deep.equal(
      incompatibleArgumentDefaultValueError(argName, parentName, childName, true, false),
    );
  });

  test('that if arguments have incompatible default values, an error is returned', () => {
    const result = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', '1'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0]).deep.equal(
      incompatibleArgumentDefaultValueTypeError(argName, parentName, childName, Kind.INT, Kind.BOOLEAN),
    );
    expect(result.errors![1]).deep.equal(
      incompatibleArgumentDefaultValueError(argName, parentName, childName, '1', false),
    );
  });
});

const subgraphWithArgument = (name: string, typeName: string): Subgraph => ({
  name,
  url: '',
  definitions: parse(`
    type Object @shareable {
      field(input: ${typeName}): String
    }
  `),
});

const subgraphWithArgumentAndDefaultValue = (name: string, typeName: string, defaultValue: string): Subgraph => ({
  name,
  url: '',
  definitions: parse(`
    type Object @shareable {
      field(input: ${typeName} = ${defaultValue}): String
    }
  `),
});
