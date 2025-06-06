import {
  getLeastRestrictiveMergedTypeNode,
  GetMergedTypeFailure,
  GetMergedTypeSuccess,
  getMostRestrictiveMergedTypeNode,
  getMutableTypeNode,
  maximumTypeNestingExceededError,
} from '../../src';
import { Kind, TypeNode } from 'graphql';
import { describe, expect, test } from 'vitest';
import { stringToTypeNode } from './utils/utils';

describe('getMergedTypeNode Tests', () => {
  const hostPath = `Parent.field`;

  test('that merging inconsistent types returns the incompatible types', () => {
    const { actualType, expectedType, success } = getLeastRestrictiveMergedTypeNode(
      nestedStringOne,
      nestedIntOne,
      hostPath,
      [],
    ) as GetMergedTypeFailure;
    expect(success).toBe(false);
    expect(expectedType).toBe('String');
    expect(actualType).toBe('Int');
  });

  test('that getLeastRestrictiveMergedTypeNode merges types into the least restrictive, mutually valid type #1', () => {
    const { success, typeNode } = getLeastRestrictiveMergedTypeNode(
      nestedStringOne,
      nestedStringTwo,
      hostPath,
      [],
    ) as GetMergedTypeSuccess;
    expect(success).toBe(true);
    expect(typeNode).toStrictEqual(nestedStringTwo);
  });

  test('that getLeastRestrictiveMergedTypeNode merges types into the least restrictive, mutually valid type #2', () => {
    const { success, typeNode } = getLeastRestrictiveMergedTypeNode(
      optionalNestedObject,
      requiredNestedObject,
      hostPath,
      [],
    ) as GetMergedTypeSuccess;
    expect(success).toBe(true);
    expect(typeNode).toStrictEqual(optionalNestedObject);
  });

  test('that least restrictively merging types that both diverge in nullability returns an error', () => {
    const { actualType, expectedType, success } = getLeastRestrictiveMergedTypeNode(
      stringToTypeNode(`[[[Float!]]]!`),
      stringToTypeNode(`[[[Float]!]]!`),
      hostPath,
      [],
    ) as GetMergedTypeFailure;
    expect(success).toBe(false);
    expect(expectedType).toBe('NonNullType');
    expect(actualType).toBe('NamedType');
  });

  test('that most restrictively merging types that both diverge in nullability returns an error', () => {
    const { actualType, expectedType, success } = getMostRestrictiveMergedTypeNode(
      stringToTypeNode(`[[[Float!]]]!`),
      stringToTypeNode(`[[[Float]!]]!`),
      hostPath,
      [],
    ) as GetMergedTypeFailure;
    expect(success).toBe(false);
    expect(expectedType).toBe('NonNullType');
    expect(actualType).toBe('NamedType');
  });

  test('that getMostRestrictiveMergedTypeNode merges types into the most restrictive, mutually valid type #1', () => {
    const { success, typeNode } = getMostRestrictiveMergedTypeNode(
      nestedStringOne,
      nestedStringTwo,
      hostPath,
      [],
    ) as GetMergedTypeSuccess;
    expect(success).toBe(true);
    expect(typeNode).toStrictEqual(nestedStringOne);
  });

  test('that getMostRestrictiveMergedTypeNode merges types into the most restrictive, mutually valid type #2', () => {
    const { success, typeNode } = getMostRestrictiveMergedTypeNode(
      optionalNestedObject,
      requiredNestedObject,
      hostPath,
      [],
    ) as GetMergedTypeSuccess;
    expect(success).toBe(true);
    expect(typeNode).toStrictEqual(requiredNestedObject);
  });

  test('that getMostRestrictiveMergedTypeNode returns an error if the maximum nesting is exceeded', () => {
    const errors: Error[] = [];
    const { success, typeNode } = getMostRestrictiveMergedTypeNode(
      simpleObjectType,
      exceededNestingLimitType,
      hostPath,
      errors,
    ) as GetMergedTypeSuccess;
    expect(success).toBe(true);
    expect(typeNode).toStrictEqual(simpleObjectType);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(maximumTypeNestingExceededError(hostPath));
  });

  test('that getLeastRestrictiveMergedTypeNode returns an error if the maximum nesting is exceeded', () => {
    const errors: Error[] = [];
    const { success, typeNode } = getLeastRestrictiveMergedTypeNode(
      simpleObjectType,
      exceededNestingLimitType,
      hostPath,
      errors,
    ) as GetMergedTypeSuccess;
    expect(success).toBe(true);
    expect(typeNode).toStrictEqual(simpleObjectType);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(maximumTypeNestingExceededError(hostPath));
  });

  test('that an error is returned if getMutableTypeNode receives a type that exceeds the nesting limit and a simplified dummy type is returned', () => {
    const errors: Error[] = [];
    const typeNode = getMutableTypeNode(exceededNestingLimitType, hostPath, errors);
    expect(typeNode).toStrictEqual(simpleObjectType);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(maximumTypeNestingExceededError(hostPath));
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

const nestedStringOne: TypeNode = stringToTypeNode(`[[[[[[[[[[String!]]!]]!]!]]]!]]`);
const nestedStringTwo: TypeNode = stringToTypeNode(`[[[[[[[[[[String]]]]]!]]]!]]`);
const nestedIntOne: TypeNode = stringToTypeNode(`[[[[[[[[[[Int!]]!]]!]!]]]!]]`);
const optionalNestedObject = stringToTypeNode(`[[[[[Object]]]]]`);
const requiredNestedObject = stringToTypeNode(`[[[[[Object!]!]!]!]!]!`);
const exceededNestingLimitType: TypeNode = stringToTypeNode(`[[[[[[[[[[[[[[[Object!]!]!]!]!]!]!]!]!]!]!]!]!]!]!]!`);
const simpleObjectType: TypeNode = stringToTypeNode(`Object`);
