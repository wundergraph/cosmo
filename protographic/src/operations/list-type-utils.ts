import { GraphQLType, GraphQLList, GraphQLNonNull, isListType, isNonNullType } from 'graphql';

/**
 * Unwraps a GraphQL type from a GraphQLNonNull wrapper
 *
 * @param graphqlType - The GraphQL type to unwrap
 * @returns The unwrapped type
 */
export function unwrapNonNullType<T extends GraphQLType>(graphqlType: T | GraphQLNonNull<T>): T {
  return isNonNullType(graphqlType) ? (graphqlType.ofType as T) : graphqlType;
}

/**
 * Checks if a GraphQL list type contains nested lists
 * Type guard that narrows the input type when nested lists are detected
 *
 * @param listType - The GraphQL list type to check
 * @returns True if the list contains nested lists
 */
export function isNestedListType(
  listType: GraphQLList<GraphQLType>,
): listType is GraphQLList<GraphQLList<GraphQLType> | GraphQLNonNull<GraphQLList<GraphQLType>>> {
  return isListType(listType.ofType) || (isNonNullType(listType.ofType) && isListType(listType.ofType.ofType));
}

/**
 * Calculates the nesting level of a GraphQL list type
 *
 * Examples:
 * - [String] → 1
 * - [[String]] → 2
 * - [[[String]]] → 3
 *
 * @param listType - The GraphQL list type to analyze
 * @returns The nesting level (1 for simple list, 2+ for nested lists)
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
