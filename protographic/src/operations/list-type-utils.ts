import { GraphQLType, GraphQLList, GraphQLNonNull, isListType, isNonNullType } from 'graphql';

/**
 * Remove a GraphQLNonNull wrapper and return its inner type.
 *
 * @param graphqlType - A GraphQL type that may be wrapped in `GraphQLNonNull`
 * @returns The inner GraphQL type if `graphqlType` is `GraphQLNonNull`, otherwise `graphqlType`
 */
export function unwrapNonNullType<T extends GraphQLType>(graphqlType: T | GraphQLNonNull<T>): T {
  return isNonNullType(graphqlType) ? (graphqlType.ofType as T) : graphqlType;
}

/**
 * Determine whether a GraphQL list type contains nested list layers.
 *
 * Acts as a type guard that narrows `listType` to a list whose element type is a `GraphQLList` or a `GraphQLNonNull` wrapping a `GraphQLList`.
 *
 * @param listType - The outer GraphQL list type to inspect
 * @returns `true` if the list contains nested lists, `false` otherwise
 */
export function isNestedListType(
  listType: GraphQLList<GraphQLType>,
): listType is GraphQLList<GraphQLList<GraphQLType> | GraphQLNonNull<GraphQLList<GraphQLType>>> {
  return isListType(listType.ofType) || (isNonNullType(listType.ofType) && isListType(listType.ofType.ofType));
}

/**
 * Determine the nesting depth of a GraphQL list type.
 *
 * @param listType - The GraphQL list to analyze
 * @returns The nesting level: `1` for a single-level list, `2` or greater for nested lists
 */
export function calculateNestingLevel(listType: GraphQLList<GraphQLType>): number {
  let level = 1;
  let currentType: GraphQLType = listType.ofType;

  while (true) {
    if (isNonNullType(currentType)) {
      currentType = currentType.ofType;
    } else if (isListType(currentType)) {
      currentType = currentType.ofType;
      level++;
    } else {
      break;
    }
  }

  return level;
}
