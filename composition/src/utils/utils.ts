import { ConstDirectiveNode, ConstValueNode, Kind, StringValueNode } from 'graphql/index';
import {
  BOOLEAN_SCALAR,
  ENUM,
  ENUM_VALUE,
  FIELD,
  FLOAT_SCALAR,
  INPUT_OBJECT,
  INPUT_VALUE,
  INT_SCALAR,
  INTERFACE,
  NULL,
  OBJECT,
  REQUIRES_SCOPES,
  SCALAR,
  SCOPES,
  STRING_SCALAR,
  UNION,
} from './string-constants';
import { invalidKeyFatalError } from '../errors/errors';
import { stringToNameNode } from '../ast/utils';

export function areSetsEqual<T>(set: Set<T>, other: Set<T>): boolean {
  if (set.size !== other.size) {
    return false;
  }
  for (const entry of set) {
    if (!other.has(entry)) {
      return false;
    }
  }
  return true;
}

export function getOrThrowError<K, V>(map: Map<K, V>, key: K, mapName: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw invalidKeyFatalError(key, mapName);
  }
  return value;
}

export function getAllSetDisparities<T>(set: Set<T>, other: Set<T>): T[] {
  const otherCopy = new Set<T>(other);
  const disparities: T[] = [];
  for (const entry of set) {
    if (!otherCopy.delete(entry)) {
      disparities.push(entry);
    }
  }
  for (const entry of otherCopy) {
    disparities.push(entry);
  }
  return disparities;
}

export function getEntriesNotInHashSet<T>(iterable: Iterable<T>, comparison: Set<T> | Map<T, any>): T[] {
  const disparities: T[] = [];
  for (const entry of iterable) {
    if (!comparison.has(entry)) {
      disparities.push(entry);
    }
  }
  return disparities;
}

export function numberToOrdinal(num: number): string {
  const numString = num.toString();
  const lastNumber = numString[numString.length - 1];
  switch (lastNumber) {
    case '1':
      return `${numString}st`;
    case '2':
      return `${numString}nd`;
    case '3':
      return `${numString}rd`;
    default:
      return `${numString}th`;
  }
}

export function addIterableValuesToSet<T>(source: T[] | Iterable<T>, target: Set<T>) {
  for (const value of source) {
    target.add(value);
  }
}

export function kindToTypeString(kind: Kind): string {
  switch (kind) {
    case Kind.BOOLEAN: {
      return BOOLEAN_SCALAR;
    }
    case Kind.ENUM:
    // intentional fallthrough
    case Kind.ENUM_TYPE_DEFINITION: {
      return ENUM;
    }
    case Kind.ENUM_TYPE_EXTENSION: {
      return 'Enum extension';
    }
    case Kind.ENUM_VALUE_DEFINITION: {
      return ENUM_VALUE;
    }
    case Kind.FIELD_DEFINITION: {
      return FIELD;
    }
    case Kind.FLOAT: {
      return FLOAT_SCALAR;
    }
    case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
      return INPUT_OBJECT;
    }
    case Kind.INPUT_OBJECT_TYPE_EXTENSION: {
      return 'Input Object extension';
    }
    case Kind.INPUT_VALUE_DEFINITION: {
      return INPUT_VALUE;
    }
    case Kind.INT: {
      return INT_SCALAR;
    }
    case Kind.INTERFACE_TYPE_DEFINITION: {
      return INTERFACE;
    }
    case Kind.INTERFACE_TYPE_EXTENSION: {
      return 'Interface extension';
    }
    case Kind.NULL: {
      return NULL;
    }
    case Kind.OBJECT:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_DEFINITION: {
      return OBJECT;
    }
    case Kind.OBJECT_TYPE_EXTENSION: {
      return 'Object extension';
    }
    case Kind.STRING: {
      return STRING_SCALAR;
    }
    case Kind.SCALAR_TYPE_DEFINITION: {
      return SCALAR;
    }
    case Kind.SCALAR_TYPE_EXTENSION: {
      return 'Scalar extension';
    }
    case Kind.UNION_TYPE_DEFINITION: {
      return UNION;
    }
    case Kind.UNION_TYPE_EXTENSION: {
      return 'Union extension';
    }
    default:
      return kind;
  }
}

export function getValueOrDefault<K, V>(map: Map<K, V>, key: K, constructor: () => V): V {
  const existingValue = map.get(key);
  if (existingValue) {
    return existingValue;
  }
  const value = constructor();
  map.set(key, value);
  return value;
}

export function add<T>(set: Set<T>, key: T): boolean {
  if (set.has(key)) {
    return false;
  }
  set.add(key);
  return true;
}

export function generateSimpleDirective(name: string): ConstDirectiveNode {
  return {
    kind: Kind.DIRECTIVE,
    name: stringToNameNode(name),
  };
}

export function generateRequiresScopesDirective(orScopes: Set<string>[]): ConstDirectiveNode {
  const values: ConstValueNode[] = [];
  for (const andScopes of orScopes) {
    const scopes: StringValueNode[] = [];
    for (const scope of andScopes) {
      scopes.push({
        kind: Kind.STRING,
        value: scope,
      });
    }
    values.push({ kind: Kind.LIST, values: scopes });
  }
  return {
    kind: Kind.DIRECTIVE,
    name: stringToNameNode(REQUIRES_SCOPES),
    arguments: [
      {
        kind: Kind.ARGUMENT,
        name: stringToNameNode(SCOPES),
        value: {
          kind: Kind.LIST,
          values,
        },
      },
    ],
  };
}
