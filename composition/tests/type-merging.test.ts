import {
  getLeastRestrictiveMergedTypeNode,
  getMostRestrictiveMergedTypeNode,
  MutableIntermediateTypeNode,
  MutableTypeNode,
} from '../src';
import { Kind, TypeNode } from 'graphql';
import { describe, expect, test } from 'vitest';

describe('getMergedTypeNode Tests', () => {
  const parentName = 'parent';
  const fieldName = 'field';

  test('that merging inconsistent types returns the incompatible types', () => {
    const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
      nestedStringOne,
      nestedIntOne,
      parentName,
      fieldName,
    );
    expect(typeNode).toBeUndefined();
    expect(typeErrors).toHaveLength(2);
    expect(typeErrors![0]).toBe('String');
    expect(typeErrors![1]).toBe('Int');
  });

  test('that getLeastRestrictiveMergedTypeNode merges types into the least restrictive, mutually valid type #1', () => {
    const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
      nestedStringOne,
      nestedStringTwo,
      parentName,
      fieldName,
    );
    expect(typeErrors).toBeUndefined();
    expect(typeNode).toStrictEqual(nestedStringTwo);
  });

  test('that getLeastRestrictiveMergedTypeNode merges types into the least restrictive, mutually valid type #2', () => {
    const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
      optionalNestedObject,
      requiredNestedObject,
      parentName,
      fieldName,
    );
    expect(typeErrors).toBeUndefined();
    expect(typeNode).toStrictEqual(optionalNestedObject);
  });

  test('that least restrictively merging types that both diverge in nullability returns an error', () => {
    const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
      stringToTypeNode(`[[[Float!]]]!`),
      stringToTypeNode(`[[[Float]!]]!`),
      parentName,
      fieldName,
    );
    expect(typeNode).toBeUndefined();
    expect(typeErrors).toHaveLength(2);
    expect(typeErrors![0]).equal('NonNullType');
    expect(typeErrors![1]).equal('NamedType');
  });

  test('that most restrictively merging types that both diverge in nullability returns an error', () => {
    const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
      stringToTypeNode(`[[[Float!]]]!`),
      stringToTypeNode(`[[[Float]!]]!`),
      parentName,
      fieldName,
    );
    expect(typeNode).toBeUndefined();
    expect(typeErrors).toHaveLength(2);
    expect(typeErrors![0]).equal('NonNullType');
    expect(typeErrors![1]).equal('NamedType');
  });

  test('that getMostRestrictiveMergedTypeNode merges types into the most restrictive, mutually valid type #1', () => {
    const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
      nestedStringOne,
      nestedStringTwo,
      parentName,
      fieldName,
    );
    expect(typeErrors).toBeUndefined();
    expect(typeNode).toStrictEqual(nestedStringOne);
  });

  test('that getMostRestrictiveMergedTypeNode merges types into the most restrictive, mutually valid type #2', () => {
    const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
      optionalNestedObject,
      requiredNestedObject,
      parentName,
      fieldName,
    );
    expect(typeErrors).toBeUndefined();
    expect(typeNode).toStrictEqual(requiredNestedObject);
  });

  test('that stringToTypeNode parses strings correctly', () => {
    expect(stringToTypeNode(`Float`)).toStrictEqual({
      kind: Kind.NAMED_TYPE,
      name: { kind: Kind.NAME, value: 'Float' },
    });
    expect(stringToTypeNode(`Int!`)).toStrictEqual({
      kind: Kind.NON_NULL_TYPE,
      type: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: 'Int' } },
    });
    expect(stringToTypeNode(`[[[[[[[[[[String]!]!]]!]]]!]!]]!`)).toStrictEqual({
      kind: Kind.NON_NULL_TYPE,
      type: {
        kind: Kind.LIST_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: {
              kind: Kind.LIST_TYPE,
              type: {
                kind: Kind.NON_NULL_TYPE,
                type: {
                  kind: Kind.LIST_TYPE,
                  type: {
                    kind: Kind.LIST_TYPE,
                    type: {
                      kind: Kind.LIST_TYPE,
                      type: {
                        kind: Kind.NON_NULL_TYPE,
                        type: {
                          kind: Kind.LIST_TYPE,
                          type: {
                            kind: Kind.LIST_TYPE,
                            type: {
                              kind: Kind.NON_NULL_TYPE,
                              type: {
                                kind: Kind.LIST_TYPE,
                                type: {
                                  kind: Kind.NON_NULL_TYPE,
                                  type: {
                                    kind: Kind.LIST_TYPE,
                                    type: {
                                      kind: Kind.NAMED_TYPE,
                                      name: {
                                        kind: Kind.NAME,
                                        value: 'String',
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(stringToTypeNode(`[[[[[[[[[[String!]]!]]!]!]]]!]]`)).toStrictEqual({
      kind: Kind.LIST_TYPE,
      type: {
        kind: Kind.LIST_TYPE,
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: {
              kind: Kind.LIST_TYPE,
              type: {
                kind: Kind.LIST_TYPE,
                type: {
                  kind: Kind.NON_NULL_TYPE,
                  type: {
                    kind: Kind.LIST_TYPE,
                    type: {
                      kind: Kind.NON_NULL_TYPE,
                      type: {
                        kind: Kind.LIST_TYPE,
                        type: {
                          kind: Kind.LIST_TYPE,
                          type: {
                            kind: Kind.NON_NULL_TYPE,
                            type: {
                              kind: Kind.LIST_TYPE,
                              type: {
                                kind: Kind.LIST_TYPE,
                                type: {
                                  kind: Kind.NON_NULL_TYPE,
                                  type: {
                                    kind: Kind.NAMED_TYPE,
                                    name: {
                                      kind: Kind.NAME,
                                      value: 'String',
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});

const stringToTypeNode = (input: string): TypeNode => {
  input = input.replaceAll('[', '');
  let typeNode: MutableIntermediateTypeNode;
  let lastNode: MutableIntermediateTypeNode | undefined;
  const lastIndex = input.length - 1;
  for (let i = lastIndex; i > -1; i--) {
    const character = input[i];
    switch (character) {
      case '!':
        if (lastNode) {
          lastNode.type = { kind: Kind.NON_NULL_TYPE, type: {} as MutableTypeNode };
          lastNode = lastNode.type;
        } else {
          typeNode = { kind: Kind.NON_NULL_TYPE, type: {} as MutableTypeNode };
          lastNode = typeNode;
        }
        break;
      case ']':
        if (lastNode) {
          lastNode.type = { kind: Kind.LIST_TYPE, type: {} as MutableTypeNode };
          lastNode = lastNode.type;
        } else {
          typeNode = { kind: Kind.LIST_TYPE, type: {} as MutableTypeNode };
          lastNode = typeNode;
        }
        break;
      default:
        const node: MutableTypeNode = {
          kind: Kind.NAMED_TYPE,
          name: { kind: Kind.NAME, value: input.slice(0, i + 1) },
        };
        if (lastNode) {
          lastNode.type = node;
          return typeNode! as TypeNode;
        }
        return node as TypeNode;
    }
  }
  throw new Error('Could not parse string.');
};

const nestedStringOne: TypeNode = stringToTypeNode(`[[[[[[[[[[String!]]!]]!]!]]]!]]`);
const nestedStringTwo: TypeNode = stringToTypeNode(`[[[[[[[[[[String]]]]]!]]]!]]`);
const nestedIntOne: TypeNode = stringToTypeNode(`[[[[[[[[[[Int!]]!]]!]!]]]!]]`);
const optionalNestedObject = stringToTypeNode(`[[[[[Object]]]]]`);
const requiredNestedObject = stringToTypeNode(`[[[[[Object!]!]!]!]!]!`);
